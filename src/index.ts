declare module 'cross-kafka' {
  export { KafkaCore } from '@core/KafkaCore';
  export { IKafkaConfigDTO as KafkaConfig } from '@interfaces/IKafkaConfigDTO';
  export { IWritePacketDTO as BaseMessage } from '@interfaces/IProxyDTO';
}
