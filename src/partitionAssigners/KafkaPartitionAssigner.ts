import kafka, {
  Cluster,
  GroupMember,
  GroupMemberAssignment,
  GroupState,
  MemberAssignment,
  MemberMetadata,
} from 'kafkajs';
import {
  IAssignmentDTO,
  IConsumerAssignmentDTO,
  IDecodedMemberDTO,
  IPreviousAssignmentDTO,
  ITopicPartitionDTO,
} from '@interfaces/IKafkaPartitionAssignerDTO';
import { isType } from '@utils/isType';

export class KafkaPartitionAssigner {
  public constructor(
    private readonly clientKafka: {
      getConsumerAssignments: () => IConsumerAssignmentDTO;
    },
    private readonly config: {
      cluster: Cluster;
    },
  ) {}

  private get name(): string {
    return 'KafkaPartitionAssigner';
  }

  private get version(): number {
    return 1;
  }

  public assign(group: {
    members: Array<GroupMember>;
    topics: Array<string>;
  }): Array<GroupMemberAssignment> {
    const assignment: IAssignmentDTO = {};
    const previousAssignment: IPreviousAssignmentDTO = {};

    const { decodedMembers, membersCount, sortedMemberIds } =
      this.getMembersData(group.members);

    this.fillPreviousAssignments({ decodedMembers, previousAssignment });

    const { topicsPartitions } = this.createTopicPartitionList(group.topics);

    this.initializeAndReassignTopicPartitions({
      assignment,
      previousAssignment,
      sortedMemberIds,
      topics: group.topics,
      topicsPartitions,
    });

    this.assignPartitionsToMembers({
      assignment,
      sortedMemberIds,
      topics: group.topics,
      topicsPartitions,
    });

    this.insertAssignmentsByTopic({
      assignment,
      membersCount,
      sortedMemberIds,
      topicsPartitions,
    });

    return Object.keys(assignment).map(memberId => ({
      memberId,
      memberAssignment: kafka.AssignerProtocol.MemberAssignment.encode({
        version: this.version,
        assignment: assignment[memberId],
      } as MemberAssignment),
    }));
  }

  public protocol(subscription: {
    topics: Array<string>;
    userData: Buffer;
  }): GroupState {
    const stringifiedUserData = JSON.stringify({
      previousAssignment: this.getPreviousAssignment(),
    });

    Object.assign(subscription, { userData: Buffer.from(stringifiedUserData) });

    return {
      name: this.name,
      metadata: kafka.AssignerProtocol.MemberMetadata.encode({
        version: this.version,
        topics: subscription.topics,
        userData: subscription.userData,
      }),
    };
  }

  private decodeMember(member: GroupMember): IDecodedMemberDTO {
    const memberMetadata = kafka.AssignerProtocol.MemberMetadata.decode(
      member.memberMetadata,
    ) as MemberMetadata;

    const memberUserData = JSON.parse(memberMetadata.userData.toString());

    return {
      memberId: member.memberId,
      previousAssignment: memberUserData.previousAssignment,
    };
  }

  private getMembersData(members: Array<GroupMember>): {
    membersCount: number;
    decodedMembers: Array<IDecodedMemberDTO>;
    sortedMemberIds: Array<string>;
  } {
    const membersCount = members.length;
    const decodedMembers = members.map(member => this.decodeMember(member));
    const sortedMemberIds = decodedMembers
      .map(member => member.memberId)
      .sort();

    return { membersCount, decodedMembers, sortedMemberIds };
  }

  private fillPreviousAssignments({
    decodedMembers,
    previousAssignment,
  }: {
    decodedMembers: Array<IDecodedMemberDTO>;
    previousAssignment: IPreviousAssignmentDTO;
  }): void {
    decodedMembers.forEach(member => {
      if (
        !previousAssignment[member.memberId] &&
        Object.keys(member.previousAssignment).length
      ) {
        Object.assign(previousAssignment, {
          [member.memberId]: member.previousAssignment,
        });
      }
    });
  }

  private createTopicPartitionList(topics: Array<string>): {
    topicsPartitions: Array<ITopicPartitionDTO>;
  } {
    const topicsPartitions = topics
      .map(topic => {
        const partitionMetadata =
          this.config.cluster.findTopicPartitionMetadata(topic);
        return partitionMetadata.map(m => {
          return {
            topic,
            partitionId: m.partitionId,
          };
        });
      })
      .reduce((acc, val) => acc.concat(val), []);

    return { topicsPartitions };
  }

  private initializeAndReassignTopicPartitions({
    assignment,
    previousAssignment,
    sortedMemberIds,
    topics,
    topicsPartitions,
  }: {
    sortedMemberIds: Array<string>;
    topicsPartitions: Array<ITopicPartitionDTO>;
    assignment: IAssignmentDTO;
    previousAssignment: IPreviousAssignmentDTO;
    topics: Array<string>;
  }): void {
    sortedMemberIds.forEach(assignee => {
      if (!assignment[assignee]) {
        Object.assign(assignment, { [assignee]: {} });
      }

      topics.forEach(topic => {
        if (!assignment[assignee][topic]) {
          Object.assign(assignment[assignee], { [topic]: [] });
        }

        if (
          previousAssignment[assignee] &&
          !isType.undefined(previousAssignment[assignee][topic])
        ) {
          const firstPartition = previousAssignment[assignee][topic];

          assignment[assignee][topic].push(firstPartition);

          const topicsPartitionsIndex = topicsPartitions.findIndex(
            topicPartition => {
              return (
                topicPartition.topic === topic &&
                topicPartition.partitionId === firstPartition
              );
            },
          );

          if (topicsPartitionsIndex !== -1) {
            topicsPartitions.splice(topicsPartitionsIndex, 1);
          }
        }
      });
    });
  }

  private assignPartitionsToMembers({
    assignment,
    sortedMemberIds,
    topics,
    topicsPartitions,
  }: {
    topicsPartitions: Array<ITopicPartitionDTO>;
    assignment: IAssignmentDTO;
    sortedMemberIds: Array<string>;
    topics: Array<string>;
  }): void {
    sortedMemberIds.forEach(assignee => {
      topics.forEach(topic => {
        if (!assignment[assignee][topic].length) {
          const topicsPartitionsIndex = topicsPartitions.findIndex(
            topicPartition => {
              return topicPartition.topic === topic;
            },
          );

          if (topicsPartitionsIndex !== -1) {
            const partition =
              topicsPartitions[topicsPartitionsIndex].partitionId;

            assignment[assignee][topic].push(partition);

            topicsPartitions.splice(topicsPartitionsIndex, 1);
          }
        }
      });
    });
  }

  private insertAssignmentsByTopic({
    assignment,
    membersCount,
    sortedMemberIds,
    topicsPartitions,
  }: {
    topicsPartitions: Array<ITopicPartitionDTO>;
    sortedMemberIds: Array<string>;
    membersCount: number;
    assignment: IAssignmentDTO;
  }): void {
    topicsPartitions.forEach((partition, index) => {
      const assignee = sortedMemberIds[index % membersCount];

      assignment[assignee][partition.topic].push(partition.partitionId);
    });
  }

  private getPreviousAssignment(): IConsumerAssignmentDTO {
    return this.clientKafka.getConsumerAssignments();
  }
}
