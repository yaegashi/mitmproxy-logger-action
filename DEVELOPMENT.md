# Development

This GitHub Action uses ncc to bundle the JavaScript files with their dependencies.

## Building

To build the bundled files for distribution:

```bash
npm run build
```

This will create bundled files in the `dist/` directory:
- `dist/index.js` - Main action
- `dist/pre/index.js` - Pre action (installs and starts mitmproxy)  
- `dist/post/index.js` - Post action (stops mitmproxy and uploads artifacts)

## Structure

- `src/` - Source JavaScript files
- `dist/` - Bundled files for distribution (generated, do not edit)
- `scripts/` - Shell scripts used by the action
- `action.yml` - Action definition

## Notes

- Always run `npm run build` after making changes to source files
- The `dist/` directory must be committed to the repository
- `node_modules/` is not committed (using ncc bundling instead)