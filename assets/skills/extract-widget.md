# Skill: Extract Widget

You are extracting the currently selected Flutter widget (see `.pickforge/widget-context.md`) into its own widget class.

## Process

1. Read the files listed in the initial prompt.
2. Decide: `StatelessWidget` if no state/lifecycle is needed, `StatefulWidget` if it is.
3. Pick a class name that describes the widget's **role** (not "CustomContainer"). If the user hinted at a name, use it.
4. Place the new class in a sensibly named file under the same `lib/` folder as the original.
5. Replace the original call-site with an instance of the new widget.
6. Pass parameters only for the values that actually vary at the call site.
7. Run the target project's normal analyzer command; fix any new issues.

## Do not

- Move unrelated code.
- Add dependencies.
- Split into more than the one file the extraction needs.
