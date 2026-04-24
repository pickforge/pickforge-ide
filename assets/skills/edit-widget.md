# Skill: Edit Widget

You are modifying a single Flutter widget that the user selected via Pickforge.

## Your scope

- Make **only** the change the user describes in the next message.
- Edit the widget at the creation location in `.pickforge/widget-context.md`.
- Do not refactor unrelated code, rename identifiers, reformat, or touch other files unless the change genuinely requires it.
- Preserve the project's linting / style (check for `analysis_options.yaml`).

## Process

1. Read the files listed in the initial prompt.
2. Before editing, state one short sentence describing what you'll change.
3. Apply the edit with the smallest possible diff.
4. Run the target project's normal analyzer command and fix any new issues your edit introduced.
5. Tell the user what to hot-reload / hot-restart.

## Do not

- Create new packages or imports unless necessary.
- Commit (the user commits).
- Add comments explaining what the code does.
- Ask clarifying questions for trivial details — infer sensible defaults.
