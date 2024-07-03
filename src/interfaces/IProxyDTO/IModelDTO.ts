import { Observable } from 'rxjs/internal/Observable';
import { IMessageOptionsDTO } from '@interfaces/IMessageOptionsDTO';
import { IPatternDTO } from '@interfaces/IPatternDTO';

export interface IModelDTO {
  close(): Promise<unknown>;
  subscribeFrom(pattern: IPatternDTO): void;
  send<Input, Output>(
    pattern: IPatternDTO,
    data: Input,
    options?: IMessageOptionsDTO,
  ): Promise<Output>;
  emit<Input>(
    pattern: IPatternDTO,
    data: Input,
    options?: IMessageOptionsDTO,
  ): Observable<unknown>;
  listen<X>(pattern: IPatternDTO, context: X, handler: keyof X): void;
}
