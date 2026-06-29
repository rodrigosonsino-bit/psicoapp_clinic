export type MessageStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';

export type MessagePlatform = 'whatsapp' | 'telegram';

export class ScheduledMessage {
    public readonly metadata: any;
    constructor(
        public readonly id: string | null,
        public readonly userId: string,
        public readonly content: string,
        public readonly recipientId: string,
        public readonly sendAt: Date,
        public status: MessageStatus = 'pending',
        public readonly platform: MessagePlatform = 'whatsapp',
        public readonly createdAt: Date = new Date(),
        metadataInput: any = null,
        public readonly recipientName: string | null = null
    ) {
        if (typeof metadataInput === 'string') {
            try {
                this.metadata = JSON.parse(metadataInput);
            } catch (e) {
                this.metadata = metadataInput;
            }
        } else {
            this.metadata = metadataInput;
        }
    }
}
