# typesense-resource-calculator

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

Does some generic analysis on your typesense collections to help optimize your RAM usage when using typesense cloud. I also include some basic statistics on your
record sizes per collection.

In order to use, set these typesense variables in your .env:
- `TYPESENSE_API_KEY`
- `TYPESENSE_HOST`
- `TYPESENSE_PORT`
- `TYPESENSE_PROTOCOL`

I'd like to note that this does NOT cover Object analysis or if a field is set to `auto`. It's difficult to accurately determine memory usage for Objects, so we just
turn it into a JSON string and utilize that as the "size" of the field. The same goes for `auto` since we can't be sure what the field's data type actually is.

There may be some miscalculations, so feel free to point them out if you come across them :)

This project was created using `bun init` in bun v1.1.40. [Bun](https://bun.sh) is a fast all-in-one JavaScript runtime.
