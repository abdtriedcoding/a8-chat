import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const QUESTIONS = [
  {
    question: "Why not just use the AI assistant I already have?",
    answer:
      "You can. Most of them tie you to one company's models and send your email through that company's servers. a8 works with any model, the code is public, and you can run it on your own server if you'd rather not trust anyone with your inbox.",
  },
  {
    question: "Is it safe to connect my email?",
    answer:
      "a8 can't send, change or delete anything until you tap Approve. Your app tokens are encrypted, every action is logged, and anyone can read the code to check how it all works.",
  },
  {
    question: "How is this different from other open-source chat apps?",
    answer:
      "Most of them are built for engineers. Before they can reach your apps you're editing config files and running servers. In a8 you connect an app by signing in to it, and that's the whole setup.",
  },
  {
    question: "What's a credit?",
    answer:
      "One credit is one US cent of model cost. A typical reply on a cheap model uses about one credit, and the bigger models use a few. Self-hosting doesn't use credits at all, since you pay OpenRouter directly.",
  },
  {
    question: "Do I have to self-host?",
    answer:
      "No. The hosted version works as soon as you sign up. Self-hosting is there if you want your data on your own server, and it has every feature.",
  },
];

export function Faq() {
  return (
    <Accordion
      type="single"
      collapsible
      className="rounded-2xl border bg-card px-6 shadow-xs"
    >
      {QUESTIONS.map(({ question, answer }) => (
        <AccordionItem key={question} value={question}>
          <AccordionTrigger className="text-base">{question}</AccordionTrigger>
          <AccordionContent className="text-base leading-relaxed text-muted-foreground">
            {answer}
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}
