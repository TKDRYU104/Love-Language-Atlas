export type Question =
  | {
      id: number;
      text: string;
      type: "open";
      followup?: boolean;
      weight?: number;
    }
  | {
      id: number;
      text: string;
      type: "yesno";
      followup?: boolean;
      weight?: number;
    }
  | {
      id: number;
      text: string;
      type: "yesno+open";
      followup?: boolean;
      weight?: number;
    }
  | {
      id: number;
      text: string;
      type: "choice";
      followup?: boolean;
      weight?: number;
      choices: string[];
    };

export const QUESTIONS: Question[] = [
  { id: 1, text: "最近、“心が動いた”瞬間ってどんなとき？", type: "open", weight: 1 },
  {
    id: 2,
    text: "誰かを好きになったら、まずどうしちゃうタイプ？",
    type: "open",
    weight: 1.2,
  },
  { id: 3, text: "一緒にいる時間って、どんな空気が理想？", type: "open", weight: 1 },
  {
    id: 4,
    text: "恋人からの連絡が少ないとき、どんな気持ちになる？",
    type: "yesno+open",
    followup: true,
    weight: 1.3,
  },
  {
    id: 5,
    text: "“愛されてるな”って感じるのは、どんな瞬間？",
    type: "open",
    weight: 1.1,
  },
  {
    id: 6,
    text: "もし別れがくるなら、どんな終わりがいい？",
    type: "open",
    weight: 1.4,
  },
  { id: 7, text: "一度終わった恋が、また始まることってあると思う？", type: "yesno", weight: 0.9 },
  { id: 8, text: "相手のために“自分を変える”のはアリ？", type: "yesno", weight: 1 },
  {
    id: 9,
    text: "言葉よりも“沈黙”のほうが伝わることってある？",
    type: "yesno+open",
    followup: true,
    weight: 1.2,
  },
  {
    id: 10,
    text: "あなたの恋は、“静かに続く”方？それとも“燃えるように始まる”方？",
    type: "choice",
    choices: ["静かに", "燃えるように", "どちらも"],
    weight: 1,
  },
];
