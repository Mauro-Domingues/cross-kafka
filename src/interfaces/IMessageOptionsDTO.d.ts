export interface IMessageOptionsDTO {
  readonly replyId?: string | Buffer | null;
  readonly headers?: Record<
    'replyId' | 'replyPartition' | 'replyTopic' | string,
    Buffer | string | Array<Buffer | string> | undefined
  >;
  readonly replyPartition?: number;
  readonly dateTime?: Date;
}
