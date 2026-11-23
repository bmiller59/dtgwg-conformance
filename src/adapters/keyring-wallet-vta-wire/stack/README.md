# The loopback mediator image (class D stand-in, wire row part 3)

> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite. Nothing here is a claim of conformance by any implementation.

The pinned mediator (`mediator:e6e2c636`, 0.48.0) resolves `did:webvh` with `HostPolicy::PublicOnly` and refuses a loopback host; nothing in its config, environment
or features relaxes it (the policy is a field of the resolver cache's `DIDCacheConfig`, default `PublicOnly`, set by the mediator in
`crates/affinidi-messaging-mediator/src/common/config/mod.rs` and `builder.rs`). `mediator-loopback.patch` is the whole change, applied in a COPY of the openvti-starter
kit (never the pinned kit): the Dockerfile adds `.with_host_policy(affinidi_did_web::HostPolicy::AllowPrivate)` to those two builders (and the dependency, so the
build is not `--locked` for the mediator), and `images:build` tags the result `mediator-buildathon:e6e2c636-loopback` only. Build: `npm run images:build -- mediator`
in the copy (about 40 minutes on a loaded 12-core machine). Test only: it re-opens the SSRF exposure the default closes.
`VTA_DID_KIND=webvh` (compose environment) then makes the VTA a `did:webvh` on its own loopback host.
