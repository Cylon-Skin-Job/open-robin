/**
 * @module resolvers
 * @role Registry of display-type resolvers
 *
 * Each display type gets its own module. Add a new type by creating
 * a new file and registering it here. If a type has no resolver,
 * the default behavior (view root = content root) applies.
 */

module.exports = {
  'file-explorer': require('./file-explorer'),
  'navigation': require('./navigation'),
  'tiled-rows': require('./tiled-rows'),
  'tabbed': require('./tabbed'),
  'columns': require('./columns'),
  'library': require('./library'),
  'terminal': require('./terminal'),
  'browser': require('./browser'),
  'calendar': require('./calendar'),
  'list': require('./list'),
};
