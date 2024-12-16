import { IConsumerAssignmentDTO } from '@interfaces/IKafkaPartitionAssignerDTO/IConsumerAssignmentDTO';

export interface IDecodedMemberDTO {
  readonly memberId: string;
  readonly previousAssignment: IConsumerAssignmentDTO;
}
