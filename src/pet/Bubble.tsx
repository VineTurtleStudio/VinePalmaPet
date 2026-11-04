export interface BubbleMessage {
  id: number;
  text: string;
}

export function Bubble({ message }: { message: BubbleMessage }) {
  return (
    <div key={message.id} className="bubble" role="status">
      {message.text}
    </div>
  );
}
