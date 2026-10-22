import { ThreadPageLoading } from "@/components/chat/starting-thread";

// Next prefetches this in production, so a click on a thread link shows the
// new URL and the skeleton at once, before the page's server response. After
// a new chat's Send, it shows the prompt instead.
export default function ThreadLoading() {
  return <ThreadPageLoading />;
}
