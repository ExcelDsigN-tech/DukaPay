# Kubernetes: strict rules

- Images are pinned to `@sha256:` digests, never a tag or `:latest` (CI: images).
- No secrets in manifests. Reference them from the secret store (CI: Gitleaks).
