# Releasing the SDK

The Python and TypeScript packages share one SDK version. This version is
independent of the Lorebo Desktop and Headless application versions.

## Registry setup

Use the `lorebo-sdk` project name in both registries. Enable two-factor
authentication on the owner accounts before the first publication.

For PyPI, configure a pending Trusted Publisher under the owner's account:

| Field             | Value         |
| ----------------- | ------------- |
| Project           | `lorebo-sdk`  |
| GitHub owner      | `lexrag`      |
| Repository        | `lorebo-sdk`  |
| Workflow filename | `publish.yml` |
| Environment       | `pypi`        |

The first successful upload creates the project and converts the pending
publisher into an ordinary Trusted Publisher.

npm requires an existing package before its Trusted Publisher can be
configured. Publish the first accepted tarball interactively from the owner's
account, then configure GitHub Actions in that package's publishing settings:
owner `lexrag`, repository `lorebo-sdk`, workflow `publish.yml`, environment
`npm`. Subsequent versions use the workflow's npm job. The initial interactive
publication does not carry GitHub Actions provenance.

Create the matching `pypi` and `npm` GitHub environments with maintainer review
and tag-only deployment protection before enabling publication. Restrict tag
creation to maintainers. Keep the source repository public for npm provenance.
Do not store registry write tokens in the repository or workflow secrets.

## Prepare and validate

1. Update `pyproject.toml` and `typescript/package.json` to the same version;
   refresh both lockfiles. Review the complete change and obtain approval.
2. Run the Checks workflow, including both test suites, type checking,
   linting, formatting and package builds. Review dependency audit results.
3. Run Publish SDK on the reviewed source with both publication inputs false.
   This builds the distributions and checks npm README/LICENSE inclusion
   without uploading anything to a registry. Download and inspect the
   resulting `sdk-<commit>` artifact and test installation in clean environments.
4. Merge the approved source, then create `v<version>` at that exact main
   commit. Publication rejects other refs and commits outside main.

## Publish

Run Publish SDK at `v<version>`, supplying the matching version and selecting
only the registries that need publication. The defaults publish neither.
The workflow runs Checks again, builds the distributions once, then publishes
the built artifacts using each registry's OIDC trust. Publication is serialized.

For the first npm version, leave its publication input false, download the
accepted npm tarball from the workflow artifact, and run:

```bash
npm login --auth-type=web
npm publish ./lorebo-sdk-<version>.tgz --access public
```

Complete the owner's browser/2FA challenge, then configure npm Trusted
Publishing for future versions. Do not upload a placeholder package.

If one registry fails, inspect its actual state before retrying and select
only the unfinished registry. Published versions are immutable; never replace
their bytes or silently increment a version to hide a failed partial release.

## Accept the result

Verify both anonymous registry metadata and the downloaded files against the
accepted distributions. Install from PyPI/npm in clean environments and test
the public imports. Verify the rendered README, license and supported
connection example. Record the source tag, package digests, CI run and observed
results in the release notes. A source test alone does not prove a real model
provider or deployed Lorebo connection; keep those checks explicit.

Official setup references: [PyPI Trusted Publishers](https://docs.pypi.org/trusted-publishers/creating-a-project-through-oidc/)
and [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/).
