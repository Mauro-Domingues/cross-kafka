import { IMessageOptionsDTO } from 'cross-proxy';

export interface IMessageDTO extends IMessageOptionsDTO {
  readonly value: string | Buffer | null;
}
