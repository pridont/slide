import type { ProjectConfig } from '../../src/project/config.js'

/**
 * A project config is optional. Without one, every markdown file under
 * `slides/` becomes a deck and the index is titled "Slides".
 */
const config: ProjectConfig = {
  title: 'Talks',
  description: 'Several decks in one repository, sharing one runtime and one stylesheet.',

  // Defaults for every deck; a deck's own frontmatter still wins.
  aspectRatio: '16/9',

  // Every `<name>.html` in here becomes a layout a slide can ask for.
  layouts: './layouts',

  // Loaded after the theme — where a custom layout's classes are styled.
  css: './theme.css',

  // Tokens for the whole project. A deck can override any of them.
  theme: {
    colorAccent: '#e6a878',
  },

  // Without this, decks are listed in filename order. Naming them puts the
  // index in the order you want to read it.
  decks: ['slides/intro.md', 'slides/layouts.md', 'slides/diagrams.md', 'slides/2026/view-transitions.md'],
}

export default config
