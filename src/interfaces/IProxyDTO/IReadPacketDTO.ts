import { IPatternDTO } from '../IPatternDTO';

export interface IReadPacketDTO<Data, Options> {
  readonly pattern: IPatternDTO;
  readonly data: Data;
  readonly options?: Options;
}
