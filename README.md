# Cross-kafka

[![socket badge](https://socket.dev/api/badge/npm/package/cross-kafka)](https://socket.dev/npm/package/cross-kafka)
&nbsp;
[![npm version](https://img.shields.io/npm/v/cross-kafka.svg?color=CB3837)](https://www.npmjs.com/package/cross-kafka)
&nbsp;
[![install size](https://packagephobia.com/badge?p=cross-kafka)](https://packagephobia.com/result?p=cross-kafka)

### An isolated core of kafkajs implementation based on @nestjs/microservices.

---

### To install the project:

```bash
npm install cross-kafka
```

---

## How to use

#### Config
all settings are common to Kafka except observerTimeout, which is the wait time for an asynchronous response.

```typescript
import { IKafkaConfigDTO, logLevel } from 'cross-kafka';

const kafkaConfig: IKafkaConfigDTO = {
  observerTimeout: 40000,
  client: {
    brokers: ['localhost:9092'],
    requestTimeout: 30000,
    logLevel: logLevel.NOTHING,
    clientId: 'my-receiver',
  },
  consumer: {
    groupId: 'my-group',
  },
};
```

#### Model
If you work with the adapter design pattern.

```typescript
import { IModel } from 'cross-kafka';

export interface IMessagingProvider extends IModel {}
```

#### Implementation
Extend a class from KafkaCore, you can also extend an interface from IModelDTO to implement the class.
It is recommended to use the singleton pattern to save resources since the initial connection is expensive.

```typescript
import { KafkaProvider } from '@providers/KafkaProvider';

export type IKafkaProvider = KafkaProvider;
```

```typescript
import { KafkaCore } from 'cross-kafka';
import { kafkaConfig } from '@config/kafkaConfig';
import { IMessagingProvider } from '@models/IMessagingProvider';
import { IKafkaProvider } from '@interfaces/IKafkaProvider';

class KafkaProvider extends KafkaCore implements IMessagingProvider {
  private static instance: IKafkaProvider;

  private constructor() {
    super(kafkaConfig);
  }

  public static getInstance(): IKafkaProvider {
    if (!KafkaProvider.instance) {
      KafkaProvider.instance = new KafkaProvider();
    }
    return KafkaProvider.instance;
  }
}

const kafkaProvider = KafkaProvider.getInstance();

export { kafkaProvider };
```

---

## How to consume (Simple-minded examples)

### - Emit
It is used to send a message in a topic. It is dynamically typed and accepts any data structure.

```typescript
import { kafkaProvider } from '@providers/kafkaProvider';

kafkaProvider.emit('TOPIC', {
  user: { age: 18, name: 'John', surname: 'Doe' },
});
```

### - Listen
Waits for a message and upon receiving it executes a callback.

```typescript
interface IUserDTO {
  name: string;
  age: number;
  id: number;
}

class UserController {
  private readonly users: Array<IUserDTO> = [];

  public async get(data: IBaseMessageDTO<number>): Promise<IUserDTO | undefined> {
    return this.users.find(user => user.id === data.response);
  }

  public async create(data: IBaseMessageDTO<IUserDTO>): Promise<void> {
    this.users.push(data.response);
  }

  public async update(
    data: IBaseMessageDTO<Partial<IUserDTO> & { id: number }>,
  ): Promise<void> {
    const user = this.users.find(user => user.id === data.response.id);

    if (user) {
      Object.assign(user, {
        name: data.response.name,
        age: data.response.age,
      });
    }
  }

  public async delete(data: IBaseMessageDTO<number>): Promise<void> {
    const userIndex = this.users.findIndex(user => user.id !== data.response);

    if (userIndex > -1) {
      this.users.splice(userIndex, 1);
    }
  }
}
```

At your entry point:

```typescript
import { kafkaProvider } from '@providers/kafkaProvider';
import { UserController } from '@controllers/userController';

const userController = new UserController();

kafkaProvider.listen('SHOW-USER', userController, 'get');
kafkaProvider.listen('CREATE-USER', userController, 'create');
kafkaProvider.listen('UPDATE-USER', userController, 'update');
kafkaProvider.listen('DELETE-USER', userController, 'delete');
```

### - SubscribeFrom
It is used to subscribe to a reply to a topic (is used in conjunction with the "send" method).

```typescript
class Controller {
  public constructor(
    private readonly messagingProvider: IMessagingProvider,
  ) {
    // It will listen 'SEND-DATA.reply'
    this.messagingProvider.subscribeFrom('SEND-DATA');
  }
}
```

### - Send
It is used to send a message and wait for the message to return (timeout defined by observerTimeout).

```typescript
interface IMessageDTO {
  reply: string;
}

class RequestController {
  public constructor(
    private readonly messagingProvider: IMessagingProvider,
  ) {
    this.messagingProvider.subscribeFrom('SEND-MESSAGE');
  }

  public async getMessage(): Promise<IMessageDTO> {
    const message: IMessageDTO = await this.messagingProvider.send(
      'SEND-MESSAGE',
      {
        message: 'Hello, send me a message!',
      },
    );

    return message;
  }
}

// At your entry point:

import express from 'express';
import { kafkaProvider } from '@providers/kafkaProvider';
import { RequestController } from '@controllers/requestController';

const app = express();
const requestController = new RequestController();

app.get('/message', requestController.getMessage);

app.listen(1234)
```

At your sender microservice:
```typescript
interface IMessageDTO {
  message: string;
}

class ReplyController {
  public constructor(
    private readonly messagingProvider: IMessagingProvider,
  ) {}

  public async sendMessage(data: IBaseMessageDTO<IMessageDTO>): Promise<void> {
    this.messagingProvider.emit(
      data.replyTopic,
      {
        reply: 'Hello, take your message!',
      },
      {
        replyId: data.replyId,
        replyPartition: data.replyPartition,
      },
    );
  }
}

// At your entry point:
import { kafkaProvider } from '@providers/kafkaProvider';
import { ReplyController } from '@controllers/replyController';

const replyController = new ReplyController(kafkaProvider);

kafkaProvider.listen('SEND-MESSAGE', replyController, 'sendMessage');
```

### - Close
It is used to close kafka connection.

```typescript
import { kafkaProvider } from '@providers/kafkaProvider';

kafkaProvider.close();
```

---