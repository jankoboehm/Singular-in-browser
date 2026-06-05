# CI security note for the WebAssembly workbench patch

This patch intentionally does not add an active `.github/workflows/*` file.
Building the WebAssembly target executes code from the pull request and runs
third-party bootstrap/configure scripts downloaded by `emscripten/build.sh`. That
is normal for this build, but it should be treated as untrusted
code execution in CI.

Recommended policy:

- Use ordinary `pull_request` checks for external contributors, not
  `pull_request_target`, when building or testing PR code.
- Set `permissions: { contents: read }` or the narrowest equivalent.
- Do not expose repository, deployment, package, or cloud secrets to the build.
- Do not run this build on persistent self-hosted runners unless the runner is
  disposable and isolated.
- Disable credential persistence in `actions/checkout` when the job does not
  need to push: `persist-credentials: false`.
- Avoid restoring or saving privileged caches from untrusted PR builds.
- Review any workflow changes before approving forked PR runs.
- Treat produced artifacts as untrusted until maintainers have reviewed the
  source, dependency pins, and build logs.
- Before publishing artifacts, pin every third-party source used by
  `emscripten/build.sh` to an immutable commit or release archive and verify
  checksums for downloaded tarballs.
- Publish the generated browser vendor and engine manifests with the artifact so
  users can verify what the browser loads.
- For public deployments, publish a signed release manifest on a protected
  GitHub branch or release path and configure the browser trust anchor described
  in `docs/DEPLOYMENT.md`.

A manual-only example workflow is provided in `ci/build-workbench.yml.example`.
