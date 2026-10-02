# PR Comment Onboarding Snippet

A template for an onboarding section appended to the end of a PR comment.
It lets developers who don't know shiori understand the tool's overview during PR review and complete adoption on their own.

## Usage

In a GitHub Actions workflow, append this snippet with `cat >> ` to the output file of
`shiori delta --format markdown`, and then post it as a PR comment.

````yaml
- name: Append onboarding section
  run: |
    cat >> .tmp/shiori-delta.md << 'ONBOARDING'

    ---

    <details>
    <summary>💡 About shiori</summary>

    **shiori** is a governance tool that tracks and manages lint disable comments and technical decisions in source code.

    This comment is posted automatically by `shiori delta`.

    ### Quick start

    ```bash
    # Install
    pnpm add -D shiori

    # Initialize the project (generates the registry + CI templates)
    pnpm shiori init

    # Detect lint disable candidates and start tracking them
    pnpm shiori candidates
    pnpm shiori adopt

    # Verify consistency with the registry
    pnpm shiori check
    ```

    📖 Details: `pnpm shiori docs` or [README](https://github.com/user/shiori#readme)

    </details>
    ONBOARDING
````

## Customization

### Change the repository URL

Replace `[README](https://github.com/user/shiori#readme)` with your project's actual URL.

### Disable the snippet

Remove this step from the workflow, or run it conditionally:

```yaml
- name: Append onboarding section
  if: ${{ env.SHIORI_ONBOARDING != 'false' }}
  run: |
    cat >> .tmp/shiori-delta.md << 'ONBOARDING'
    ...
    ONBOARDING
```

## Related

- [Delta PR Comment recipe](./github-actions-delta-pr-comment.md)
- [Delta PR Description recipe](./github-actions-delta-pr-description.md)
