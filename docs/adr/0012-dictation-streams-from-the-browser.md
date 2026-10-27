# Dictation audio streams from the browser straight to the speech provider

Dictation opens a WebSocket from the browser to the speech-to-text provider, authenticated by a short-lived token that a Convex action mints after its rate limits pass. Audio never passes through a8. Convex functions can't hold a socket open for a whole dictation, and relaying audio through a server of our own would add latency to every word plus a service to run. Words have to show up while the user is still speaking. The provider is Deepgram's Flux Multilingual model (`flux-general-multi` on `/v2/listen`), because Deepgram's free credit lets dictation ship at no cost and Flux handles Hindi and English mixed in one sentence. Soniox replaces it once dictation costs real money.

Flux sends the words heard so far every 240ms. When we dictated the clips in `fixtures/` in Chrome from India, the first words showed 0.6 to 0.9s after speech started. Nova-3 with `language=multi`, which dictation used first, sends them once per second of audio whatever the settings, so its first words took 1.1 to 1.2s. Flux costs about a third more per minute and puts fewer full stops in a long turn.

Getting a token and opening the socket take about 2s from India. So the composer opens a socket ahead of time, and loads the audio worklet, and a tap within 50s uses them. The pointer or focus reaching the mic always does this. The message box getting focus does it only in a browser that has dictated before, so people who never dictate don't use up the dictation limits. Deepgram closes a Flux socket after 60s without audio, and a browser can't send the pings that would keep it open. Without a warm socket, the mic listens as soon as it's on and holds the audio until its socket opens.

## Considered options

- **The browser's built-in speech recognition:** free and needs no backend, but Firefox and Brave lack it, Chrome sends the audio to Google, and accuracy is lower.
- **Record, then transcribe:** simpler, but no text appears until the user stops talking.
- **Nova-3 with `language=multi`:** cheaper, punctuates better, and a socket stays open for free with `KeepAlive` messages. Its first words take twice as long as Flux's.
- **Soniox now:** about a third of Deepgram's price, never trains on audio, takes the browser's recorded audio as is, and its token can cap session length. Its free credits have ended, so it waits until dictation has a budget.

## Consequences

- a8 sees when a socket opens but not how long a dictation runs, so usage is capped by how often a user can open one, warm-ups included, and the client ends a session after 5 minutes. The Deepgram token only has to be valid when the socket opens, so the provider doesn't enforce that cap, and a script can hold a socket open for as long as it likes. Deepgram's grant has no option to cap a session or scope a token. For its 30 seconds, a token also works for Deepgram's prerecorded, text-to-speech and Voice Agent APIs. Only a relay or Soniox's session-capped token would bound minutes.
- So the token action checks the session row, not just the JWT, which outlives a sign-out by up to 15 minutes. On the hosted a8, each token costs one credit, about 1.3 minutes of Flux, and needs credits left and the day's spend under the ceiling, like a send. a8 can't tell a warm-up from a dictation, so a warm-up costs the same. The daily limit on starts is 60 on Free, 300 on Pro and 600 self-hosted.
- Deepgram bills for the audio sent, so a warm socket that's never used costs nothing.
- Every connection must pass `mip_opt_out=true`, or Deepgram trains on users' audio.
- Hindi words come back in Devanagari and English words in Latin script.
- Deepgram details stay inside the token action and the dictation hook, so switching to Soniox changes only those two.
