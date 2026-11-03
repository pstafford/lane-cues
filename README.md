# Lane Cues

Mixes a coach's voice clips into your own swim music at set times, and saves one MP3 for swim headphones. The music dips under each cue and swells back afterwards. It is a static web page: audio is decoded, mixed and encoded in the browser, and nothing is uploaded.

## Using it

1. Add music: one long mix, or several tracks to play in order, with an optional gap or crossfade between them.
2. Add voice clips (MP3, M4A such as iPhone Voice Memos, or WAV).
3. Set cue times from the start of the whole mix (`m:ss`, or a bare number of minutes), or repeat a clip on an interval.
4. Adjust the mix if needed, press **Mix it**, listen at any cue, then **Save MP3**.

To load the result, connect the headphones by USB (for example a Shokz OpenSwim in MP3 mode), drag the MP3 onto the drive, and eject.

### The defaults, and why

They are tuned for bone conduction in a pool:

- Music ducks by 18 dB, starting 0.4 s before the voice, fading down over 0.6 s and back over 1.5 s. Cues close together share one dip.
- Bone-conduction EQ: a 90 Hz high-pass on the music (deep bass buzzes on the cheekbone and wastes headroom) and a 160 Hz high-pass plus a +5 dB lift at 3 kHz on the voice.
- Mono output, so a cue is not lost if one pad moves.
- A limiter and peak normalising to about −1 dBFS, for level on a small transducer.
- An optional two-note chime before each cue.

## Limits

- Apple Music downloads and protected `.m4p` purchases are DRM-locked and cannot be decoded. Apple Lossless `.m4a` files may only open in Safari.
- The browser keeps every decoded track in memory while mixing, so keep a mix to about an hour, especially on a phone.

## Developing

```
npm test
python3 -m http.server   # then open http://localhost:8000
```

There is no build step and no runtime dependencies to install. `src/plan.js` holds the timing logic (track layout, duck envelopes, time parsing) and is unit-tested; `src/mix.js` renders the mix with an `OfflineAudioContext` and encodes MP3; `src/app.js` is the interface. `vendor/lame.min.js` is [lamejs](https://github.com/zhuker/lamejs) 1.2.1 (LGPL-3.0), a JavaScript port of [LAME](https://lame.sourceforge.io/), loaded unmodified as a separate file; the MP3 test runs the same file.

## Hosting

Push to GitHub and enable Pages for the `main` branch, root folder.
