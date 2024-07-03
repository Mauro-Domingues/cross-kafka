import { IMessageOptionsDTO } from '@interfaces/IMessageOptionsDTO';

export interface IMessageDTO extends IMessageOptionsDTO {
  readonly value: string | Buffer | null;
}
