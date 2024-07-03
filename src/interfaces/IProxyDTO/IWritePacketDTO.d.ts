export interface IWritePacketDTO<Data> {
  readonly replyId?: string;
  readonly error?: unknown;
  readonly response?: Data;
  readonly isDisposed?: boolean;
  readonly replyPartition?: number;
  readonly replyTopic: string;
}
