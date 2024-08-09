import { randomUUID } from 'node:crypto';
import { Observable } from 'rxjs/internal/Observable';
import { connectable } from 'rxjs/internal/observable/connectable';
import { defer } from 'rxjs/internal/observable/defer';
import { EMPTY } from 'rxjs/internal/observable/empty';
import { catchError } from 'rxjs/internal/operators/catchError';
import { mergeMap } from 'rxjs/internal/operators/mergeMap';
import { timeout } from 'rxjs/internal/operators/timeout';
import { Subject } from 'rxjs/internal/Subject';
import { Observer } from 'rxjs/internal/types';
import { IMessageOptionsDTO } from '@interfaces/IMessageOptionsDTO';
import { IPatternDTO } from '@interfaces/IPatternDTO';
import { IWritePacketDTO, IReadPacketDTO, IModel } from '@interfaces/IProxyDTO';
import { isType } from '@utils/isType';

export abstract class Proxy<MessageOptions> implements IModel {
  protected readonly consumerAssignments: Record<string, number> = {};
  protected declare readonly observerTimeout: number;
  protected readonly routingMap = new Map<
    string,
    (packet: IWritePacketDTO<unknown>) => void
  >();
  protected readonly handlers = new Map<
    string,
    (data: IWritePacketDTO<unknown>) => unknown
  >();

  public close(): Promise<unknown> {
    return this.closeConnections();
  }

  public subscribeFrom(pattern: IPatternDTO): void {
    return this.subscribe(pattern);
  }

  public send<Input, Output>(
    pattern: IPatternDTO,
    data: Input,
    options?: IMessageOptionsDTO,
  ): Promise<Output> {
    this.checkBeforeEmit({ data, pattern });

    return new Promise<Output>((resolve, reject) => {
      defer(async () => this.connect())
        .pipe(
          mergeMap(
            () =>
              new Observable((observer: Observer<Output>) => {
                return this.publish<Input, Output>({
                  partialPacket: {
                    pattern,
                    data,
                    options,
                  },
                  callback: this.createObserver<Output>(observer),
                });
              }),
          ),
          timeout(this.observerTimeout),
          catchError(error => {
            reject(error);
            return EMPTY;
          }),
        )
        .subscribe({
          next: message => {
            if (!message) {
              reject(new Error('The message received is empty'));
            } else {
              resolve(message);
            }
          },
          error: (error: unknown) => reject(error),
        });
    });
  }

  public emit<Input>(
    pattern: IPatternDTO,
    data: Input,
    options?: IMessageOptionsDTO,
  ): Observable<unknown> {
    this.checkBeforeEmit({ data, pattern });

    const source = defer(async () => this.connect()).pipe(
      mergeMap(() =>
        this.dispatchEvent({
          pattern,
          data,
          options,
        }),
      ),
    );
    const connectableSource = connectable(source, {
      connector: () => new Subject(),
      resetOnDisconnect: false,
    });
    connectableSource.connect();
    return connectableSource;
  }

  public listen<X>(pattern: IPatternDTO, context: X, handler: keyof X): void {
    Promise.resolve(
      this.setListener({
        pattern,
        handler: (
          context[handler] as (data: IWritePacketDTO<unknown>) => unknown
        ).bind(context),
      }),
    ).then(() => this.connect());
  }

  protected abstract connect(): Promise<unknown>;

  protected abstract closeConnections(): Promise<unknown>;

  protected abstract subscribe(pattern: IPatternDTO): void;

  protected abstract serializeMessageOptions(
    options?: IMessageOptionsDTO,
  ): MessageOptions;

  protected abstract deserializeMessage<Input>(
    value: Input,
    message: MessageOptions,
  ): IWritePacketDTO<Input> & { id: string };

  protected abstract decode<Input, Val>(
    value: Val,
  ): Input | string | null | Buffer;

  protected abstract setListener<T, X>(data: {
    pattern: IPatternDTO;
    handler: (data: IWritePacketDTO<T>) => X;
  }): void;

  protected abstract publish<Input, Output>(data: {
    partialPacket: IReadPacketDTO<Input, IMessageOptionsDTO>;
    callback: (packet: IWritePacketDTO<Output>) => void;
  }): () => void | undefined;

  protected abstract dispatchEvent<Input>(
    packet: IReadPacketDTO<Input, IMessageOptionsDTO>,
  ): Promise<unknown>;

  protected assignPacketId<T>(
    packet: IReadPacketDTO<T, MessageOptions>,
  ): IReadPacketDTO<T, MessageOptions> & { replyId: string } {
    return Object.assign(packet, { replyId: randomUUID() });
  }

  protected normalizePattern(pattern: IPatternDTO): string {
    if (isType.string(pattern) || isType.number(pattern)) {
      return `${pattern}`;
    }

    if (!isType.object(pattern)) {
      return pattern;
    }

    const sortedKeys = Object.keys(pattern).sort((a, b) =>
      `${a}`.localeCompare(b),
    );

    const sortedPatternParams = sortedKeys.map(key => {
      let partialRoute = `"${key}":`;
      partialRoute += isType.string(pattern[key])
        ? `"${this.normalizePattern(pattern[key])}"`
        : this.normalizePattern(pattern[key]);
      return partialRoute;
    });

    const route = sortedPatternParams.join(',');
    return `{${route}}`;
  }

  protected getReplyTopicPartition(topic: string): string {
    const minimumPartition = this.consumerAssignments[topic];

    if (isType.undefined(minimumPartition)) {
      throw new Error(topic);
    }

    return minimumPartition.toString();
  }

  protected decodeHeaderByKey<T>({
    data,
    result,
  }: {
    result: T;
    data: T;
  }): void {
    if (result && data) {
      Object.keys(data).forEach(key =>
        Object.assign(result, {
          [key]: this.decode((data as Record<string, unknown>)?.[key]),
        }),
      );
    }
  }

  private checkBeforeEmit<Input>({
    pattern,
    data,
  }: IReadPacketDTO<Input, MessageOptions>): void {
    if (isType.nullish(pattern)) {
      throw new Error(
        "Uncaught TypeError: Cannot read properties of undefined (reading 'pattern')",
      );
    }

    if (isType.nullish(data)) {
      throw new Error(
        "Uncaught TypeError: Cannot read properties of undefined (reading 'data')",
      );
    }
  }

  private createObserver<T>(
    observer: Observer<T>,
  ): (packet: IWritePacketDTO<T>) => void {
    return ({ error, response, isDisposed }: IWritePacketDTO<T>) => {
      if (error) {
        return observer.error(error);
      }
      if (!isType.undefined(response) && isDisposed) {
        observer.next(response);
        return observer.complete();
      }
      if (isDisposed) {
        return observer.complete();
      }
      return observer.next(response as T);
    };
  }
}
