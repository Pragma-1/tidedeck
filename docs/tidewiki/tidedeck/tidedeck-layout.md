---
title: "Editing the board"
---

Everything on the dashboard is changed on the dashboard itself. Edit mode only changes how things can be moved — every change is saved within a second and appears in every other open tab and device.

![Edit mode with grid guides, block toolbars and corner handles](/media/tidedeck-edit-mode.webp)

## Edit mode

Click **Edit** in the header or press `e`. Leave it with **Done** or `Esc`.

| To | Do |
| --- | --- |
| Move a block | Drag it anywhere (on touch screens: by the grip in its toolbar) |
| Resize | Pull any corner or edge; it snaps to the grid while you pull |
| Open its settings | Double-click it, or the sliders button in its toolbar |
| Duplicate / remove | Buttons in the toolbar. **Undo** appears for a few seconds after removing |
| Add a block | **Add block** in the header |
| Re-order apps in a group | Drag the tiles inside the group (or use Space and the arrow keys) |
| Copy or move a block to another board | The folder button in its toolbar: **Copy to** or **Move to** a board, or a new one |
| Copy or move an app | Right-click it (long-press on touch screens), in or out of edit mode: **Copy to** / **Move to** a board, then *as a block of its own* or *into an app group* there |

The header shows **Saved** once a change has reached the server. If two people change the same thing at once, the second gets a notice instead of overwriting the first.

### Copying and moving between boards

A copy is new and independent: changing it doesn't change the original. A moved block is the same block, so a connected music player stays signed in; a copied one has to be signed in to its server again (its settings say so). Copied and moved blocks go to the bottom of the other board. After each copy or move, a note offers **Show** (go to that board) and **Undo**. Only someone signed in gets these menu entries.

## Making room

Blocks stay exactly where you drop them. Nothing floats up to fill empty space, and a block doesn't have to touch another one — leave gaps wherever you like. Moving a block away leaves its spot empty; the blocks around it don't move.

Only when blocks would overlap do they make way. While you drag or resize, the edges where the block meets its neighbours light up, the dashed outline shows where it will land, and the blocks that make way glide there:

- **Making a block wider** narrows the blocks beside it (down to their smallest size) instead of pushing them underneath. Only when they can't get any narrower do they move down.
- **Dragging a block into a gap** that's narrower than the block makes it fit the gap (down to its smallest size), so it sits next to a big block instead of shoving it away.
- **Dropping a block right onto another** still moves the other one down — that's how you swap places.
- **Blocks that had to make way go back** as soon as there's room again: make a block huge, and the blocks it pushed down or narrowed return to their spot and width when you shrink it (as far as there's room if you only shrink it partway). The board shrinks back with them. This holds after a reload too. A block you then move or resize yourself stays where you put it, and a spot you drop another block onto is taken.
- A block stays inside the board as long as its middle is inside; drag its middle past the right edge to make the board wider.
- Drag a block (or pull its left edge) past the **left** edge of the board and new columns appear there: everything else moves over by that much and the page scrolls along, so nothing jumps. Columns you don't end up using disappear again when you let go.

## Boards

Boards are the tabs in the header (_Home_, _Media_ …). In edit mode:

- **+ Board** adds one.
- The arrow next to a board renames it, moves it left/right or deletes it.
- The address contains the board (`/?board=media`), so a bookmark opens it directly.

## The grid

- 48 columns on wide screens and rows of 9 px — fine enough to line things up exactly, while the space between blocks stays the same. The dots in edit mode mark every second column and every third row; blocks snap in between too.
- The board has **no fixed size**, but it's never bigger than its blocks need: normally exactly the width of the page. Push a block *past* the right or left edge (with the pointer out in the page margin) and the page grows; near the window edge it scrolls along. Columns that end up empty disappear again when you let go, and the board snaps back to the page width, centred under the header. Sideways growth is for mouse-driven screens; on phones and tablets the board keeps the screen width.

## Layouts per screen size

Desktop, medium screens, tablets and phones each keep their own arrangement:

- Arrange the board on the desktop first.
- Narrower screens get a layout made from it automatically: scaled on medium screens, **two columns** on tablets, **one column** on phones.
- As soon as you move something on a narrower screen, that screen keeps its own layout from then on.

::: tip Arranging the phone layout
Open the dashboard on the phone (or make the browser window narrow), click **Edit** and arrange it. Desktop stays as it was.
:::

## Content zoom per block

Each block can show its content larger or smaller (50–250 %) without taking more room on the grid — a huge clock, a dense list of links:

- In edit mode: hold `Ctrl` and scroll over the block, or pinch on a trackpad.
- Or: the **Content zoom** slider in the block's settings.
- The percentage shows in the block's toolbar; click it to go back to 100 %.
- A zoomed-out block may also be made smaller than usual (its smallest size shrinks with the zoom), so there's no empty space left under the smaller content. A zoomed-in block needs correspondingly more room.

The zoom belongs to the screen size, like the layout. For the size of the whole dashboard see [[tidedeck-themes|Look, size and wall screens]].

## Keyboard

| Key | |
| --- | --- |
| `e` | Edit mode on/off |
| `Esc` | Leave edit mode or close a dialog |
| `Ctrl+K` / `⌘K` | Quick launch |
| `/` | The board's search box |

Next: [[tidedeck-modules|Blocks]].
