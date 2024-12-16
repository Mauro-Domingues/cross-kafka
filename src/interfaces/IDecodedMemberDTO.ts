import { IConsumerAssignmentDTO } from '@interfaces/IConsumerAssignmentDTO';

export interface IDecodedMemberDTO {
  readonly memberId: string;
  readonly previousAssignment: IConsumerAssignmentDTO;
}
