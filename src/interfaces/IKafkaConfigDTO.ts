import {
  KafkaConfig,
  ConsumerConfig,
  ConsumerRunConfig,
  ProducerConfig,
  ProducerRecord,
} from 'kafkajs';

export interface IKafkaConfigDTO {
  readonly producerOnly?: boolean;
  readonly client?: KafkaConfig;
  readonly consumer?: ConsumerConfig;
  readonly run?: Omit<ConsumerRunConfig, 'eachBatch' | 'eachMessage'>;
  readonly producer?: ProducerConfig;
  readonly send?: Omit<ProducerRecord, 'topic' | 'messages'>;
}
