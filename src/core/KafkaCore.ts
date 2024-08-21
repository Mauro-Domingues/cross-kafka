import {
  Consumer,
  ConsumerConfig,
  ConsumerGroupJoinEvent,
  EachMessagePayload,
  Kafka,
  Message,
  Partitioners,
  Producer,
  ProducerRecord,
  RecordMetadata,
  logLevel,
} from 'kafkajs';
import { Proxy } from '@base/Proxy';
import { IKafkaConfigDTO } from '@interfaces/IKafkaConfigDTO';
import { IConsumerAssignmentDTO } from '@interfaces/IKafkaPartitionAssignerDTO';
import { IMessageOptionsDTO } from '@interfaces/IMessageOptionsDTO';
import { IPatternDTO } from '@interfaces/IPatternDTO';
import { IReadPacketDTO, IWritePacketDTO } from '@interfaces/IProxyDTO';
import { KafkaPartitionAssigner } from '@partitionAssigners/KafkaPartitionAssigner';
import { isType } from '@utils/isType';

export abstract class KafkaCore extends Proxy<Omit<Message, 'value'>> {
  private readonly responsePatterns: Array<string> = [];
  private readonly config: IKafkaConfigDTO | undefined;
  private declare initialized: Promise<void> | null;
  protected readonly observerTimeout: number;
  private declare producer: Producer;
  private declare consumer: Consumer;
  private declare client: Kafka;
  private readonly defaults = {
    observerTimeout: 30000,
    client: {
      brokers: ['localhost:9092'],
      requestTimeout: 30000,
      logLevel: logLevel.NOTHING,
      clientId: 'my-kafka',
    },
    consumer: {
      groupId: 'my-consumer',
    },
    run: {},
    producer: {},
    send: {},
  } as Required<IKafkaConfigDTO>;

  public constructor(config?: IKafkaConfigDTO) {
    super();
    this.config = config;
    this.observerTimeout =
      this.config?.observerTimeout ?? this.defaults.observerTimeout;
  }

  protected getConsumerAssignments(): IConsumerAssignmentDTO {
    return this.consumerAssignments;
  }

  protected async connect(): Promise<Producer> {
    if (this.initialized) {
      return this.initialized.then(() => this.producer);
    }
    this.initialized = new Promise<void | undefined>((resolve, reject) => {
      try {
        this.client = this.createClient();

        this.producer = this.client.producer({
          ...(this.config?.producer ?? this?.defaults?.producer),
          allowAutoTopicCreation: true,
          createPartitioner: Partitioners.DefaultPartitioner,
        });

        if (!this.config?.producerOnly) {
          const partitionAssigners = [
            (config: ConstructorParameters<typeof KafkaPartitionAssigner>[1]) =>
              new KafkaPartitionAssigner(this, config),
          ];

          const consumerOptions = {
            partitionAssigners,
            ...(this.config?.consumer ?? this.defaults?.consumer),
            allowAutoTopicCreation: true,
          } as ConsumerConfig;

          this.consumer = this.client.consumer(consumerOptions);

          this.consumer.on(
            this.consumer.events.GROUP_JOIN,
            this.setConsumerAssignments.bind(this),
          );

          resolve(
            this.consumer
              .connect()
              .then(() => this.bindTopics())
              .then(() => this.producer.connect()),
          );
        } else {
          resolve(this.producer.connect());
        }
      } catch (err) {
        reject(err);
      }
    });

    return this.initialized.then(() => this.producer);
  }

  protected async closeConnections(): Promise<void> {
    await this.producer.disconnect();
    await this.consumer.disconnect();
  }

  protected subscribe(pattern: IPatternDTO): void {
    const request = this.normalizePattern(pattern);
    this.responsePatterns.push(this.getResponsePatternName(request));
  }

  protected serializeMessageOptions(
    options?: IMessageOptionsDTO,
  ): Omit<Message, 'value'> {
    return {
      headers: options?.headers,
      key: options?.replyId,
      partition: options?.replyPartition,
      timestamp: options?.dateTime?.toISOString(),
    };
  }

  protected deserializeMessage<Input>(
    value: Input,
    message: Message,
  ): IWritePacketDTO<Input> & { id: string } {
    const replyId = message?.headers?.replyId?.toString();
    const replyTopic = message?.headers?.replyTopic?.toString() as string;
    const partition = Number(message?.headers?.replyPartition?.toString());
    const id = message?.key?.toString() as string;

    const replyPartition =
      isType.number(partition) && !isType.nan(partition)
        ? partition
        : undefined;

    if (!isType.undefined(message?.headers?.error)) {
      return {
        error: message.headers?.error,
        isDisposed: true,
        replyPartition,
        replyTopic,
        replyId,
        id,
      };
    }
    if (!isType.undefined(message?.headers?.isDisposed)) {
      return {
        response: this.decode(value) as Input,
        isDisposed: true,
        replyPartition,
        replyTopic,
        replyId,
        id,
      };
    }
    return {
      response: this.decode(value) as Input,
      isDisposed: false,
      replyPartition,
      replyTopic,
      replyId,
      id,
    };
  }

  protected decode<Input, Val>(value: Val): Input | string | null | Buffer {
    if (isType.nullish(value)) {
      return null;
    }
    if (isType.buffer(value) && value.length && value.readUInt8(0) === 0) {
      return value;
    }

    let result = (value as { toString: () => string }).toString();
    const startChar = result.charAt(0);

    if (startChar === '{' || startChar === '[') {
      result = JSON.parse((value as { toString: () => string }).toString());
    }

    return result;
  }

  protected setListener<T, X>({
    handlers,
    pattern,
  }: {
    pattern: IPatternDTO;
    handlers: Array<(data: IWritePacketDTO<T>) => X>;
  }): void {
    const topic = this.normalizePattern(pattern);

    this.handlers.set(
      topic,
      handlers as Array<(data: IWritePacketDTO<unknown>) => unknown>,
    );

    this.responsePatterns.push(topic);
  }

  protected publish<Input, Output>({
    callback,
    partialPacket,
  }: {
    partialPacket: IReadPacketDTO<Input, IMessageOptionsDTO>;
    callback: (packet: IWritePacketDTO<Output>) => void;
  }): () => void | undefined {
    const packet = this.assignPacketId(partialPacket);
    this.routingMap.set(
      packet.replyId,
      callback as (packet: IWritePacketDTO<unknown>) => void,
    );

    const cleanup = () => {
      this.routingMap.delete(packet.replyId);
    };
    const errorCallback = (error: unknown) => {
      cleanup();
      callback({ error } as IWritePacketDTO<Output>);
    };

    try {
      const pattern = this.normalizePattern(partialPacket.pattern);
      const replyTopic = this.getResponsePatternName(pattern);
      const replyPartition = this.getReplyTopicPartition(replyTopic);

      Promise.resolve(this.serialize(packet.data, packet?.options))
        .then((serializedPacket: ProducerRecord['messages'][number]) => {
          Object.assign(serializedPacket, {
            headers: {
              replyId: packet.replyId,
              replyTopic,
              replyPartition,
            },
          });

          const message = {
            topic: pattern,
            messages: [serializedPacket],
          };

          return this.producer.send(message);
        })
        .catch(err => errorCallback(err));

      return cleanup;
    } catch (err) {
      errorCallback(err);
      return () => {};
    }
  }

  protected dispatchEvent<Input>(
    packet: IReadPacketDTO<Input, IMessageOptionsDTO>,
  ): Promise<Array<RecordMetadata>> {
    Object.assign(packet, {
      options: {
        ...packet?.options,
        headers: { ...packet?.options?.headers, isDisposed: 'true' },
      },
    });

    const pattern = this.normalizePattern(packet.pattern);
    const outgoingEvent = this.serialize(packet.data, packet.options);

    const message = {
      topic: pattern,
      messages: [outgoingEvent],
      ...(this.config?.send ?? this.defaults?.send),
    };

    return this.producer.send(message);
  }

  private createClient(): Kafka {
    return new Kafka(this.config?.client ?? this.defaults?.client);
  }

  private createResponseCallback(): (
    payload: EachMessagePayload,
  ) => Promise<void> {
    return async (payload: EachMessagePayload) => {
      const rawMessage = this.parse(
        Object.assign(payload.message, {
          topic: payload.topic,
          partition: payload.partition,
        }),
      );

      const { id, error, isDisposed, replyId, ...rest } =
        this.deserializeMessage(rawMessage.value, rawMessage);

      const handlers = this.handlers.get(payload.topic);

      if (handlers?.length) {
        handlers?.reduce<Promise<unknown>>(async (prev, next) => {
          await prev;

          return next({ replyId, error, isDisposed, ...rest });
        }, Promise.resolve());

        return;
      }

      if (isType.undefined(id)) {
        return;
      }

      const callback = this.routingMap.get(id);
      if (!callback) {
        return;
      }
      if (error || isDisposed) {
        callback({
          isDisposed,
          replyId,
          ...rest,
          error,
        });
      }
      callback({
        replyId,
        ...rest,
        error,
      });
    };
  }

  private setConsumerAssignments(data: ConsumerGroupJoinEvent): void {
    Object.keys(data.payload.memberAssignment).forEach(topic => {
      const memberPartitions = data.payload.memberAssignment[topic];

      if (memberPartitions.length) {
        this.consumerAssignments[topic] = Math.min(...memberPartitions);
      }
    });
  }

  private getResponsePatternName(pattern: string): string {
    return `${pattern}.reply`;
  }

  private async bindTopics(): Promise<void> {
    if (!this?.consumer) {
      throw Error('No consumer initialized');
    }

    if (this.responsePatterns.length) {
      await this.consumer.subscribe({
        topics: this.responsePatterns,
        fromBeginning: true,
      });
    }

    await this.consumer.run({
      ...(this.config?.run ?? this.defaults?.run),
      eachMessage: this.createResponseCallback(),
    });
  }

  private serialize<T>(value: T, options?: IMessageOptionsDTO): Message {
    const { headers, key, partition, timestamp } =
      this.serializeMessageOptions(options);

    const message: Message = {
      value: this.encode(value),
      headers,
      partition,
      timestamp,
    };

    if (!isType.nullish(key)) {
      message.key = this.encode(key);
    }
    if (isType.nullish(headers)) {
      message.headers = {};
    }
    return message;
  }

  private parse(data: Message): Message {
    const result: Message = {
      ...data,
      headers: { ...data.headers },
    };

    if (!isType.nullish(data.key)) {
      this.decodeHeaderByKey({
        data: data.key,
        result: result.key,
      });
    }

    if (!isType.nullish(data.headers)) {
      this.decodeHeaderByKey({
        data: data.headers,
        result: result.headers,
      });
    } else {
      result.headers = {};
    }

    return result;
  }

  private encode<T>(value: T): Buffer | string | null {
    const isObjectOrArray =
      !isType.nullish(value) &&
      !isType.string(value) &&
      !Buffer.isBuffer(value);

    if (isObjectOrArray) {
      return isType.plainObject(value) || isType.array(value)
        ? JSON.stringify(value)
        : (value as { toString: () => string }).toString();
    }
    if (isType.undefined(value)) {
      return null;
    }
    return value;
  }
}
