---
"@hedwigjs/broker": patch
---

Binary payloads no longer break `emit()` / `request()`. The immutability
step (`deepFreeze`) used to call `Object.freeze` on every nested value,
which throws on typed arrays with elements — any message carrying a
`Uint8Array`, `Float64Array`, `DataView` or `ArrayBuffer` rejected the
pipeline, including frames arriving through a bridge via structured
clone. Binary values are now left mutable and skipped; the envelope and
every non-binary part of the payload are still frozen.

Also documented: freezing happens in place on the object the emitter
passed, not on a copy.
