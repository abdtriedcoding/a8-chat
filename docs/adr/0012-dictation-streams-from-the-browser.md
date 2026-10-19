# Dictation audio streams from the browser straight to the speech provider

Dictation opens a WebSocket from the browser to the speech-to-text provider, authenticated by a short-lived token that a Convex action mints after its rate limits pass. Audio never passes through a8. Convex functions can't hold a socket open for a whole dictation, and relaying audio through a server of our own would add latency to every word plus a service to run. Words have to show up while the user is still speaking. The provider is Deepgram Nova-3 with `language=multi` for now, because its free credit lets dictation ship at no cost and it handles Hindi and English mixed in one sentence. Soniox replaces it once dictation costs real money.

## Considered options

- **The browser's built-in speech recognition:** free and needs no backend, but Firefox and Brave lack it, Chrome sends the audio to Google, and accuracy is lower.
- **Record, then transcribe:** simpler, but no text appears until the user stops talking.
- **Soniox now:** about a third of Deepgram's price, never trains on audio, takes the browser's recorded audio as is, and its token can cap session length. Its free credits have ended, so it waits until dictation has a budget.

## Consequences

- a8 sees when a dictation starts but not how long it runs, so usage is capped by how often a user can start one, and the client ends a session after 5 minutes. The Deepgram token only has to be valid when the socket opens, so the provider doesn't enforce that cap.
- Every connection must pass `mip_opt_out=true`, or Deepgram trains on users' audio.
- Deepgram details stay inside the token action and the dictation hook, so switching to Soniox changes only those two.
