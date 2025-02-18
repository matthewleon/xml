//Imports
import { $XML, entities, schema, tokens } from "./types.ts";
import type { extract, literal, node, StringifierOptions, udocument } from "./types.ts";

/**
 * XML stringifier helper
 */
export class Stringifier {
  /** Constructor */
  constructor(document: udocument, options: StringifierOptions = {}) {
    this.#document = document;
    this.#options = options;
    this.#options.replacer ??= function ({ value }) {
      return value;
    };
  }

  /** Stringify document */
  stringify() {
    const document = this.#make.extraction(this.#document);

    //Prolog and doctype
    if (document.raw.xml) {
      this.#prolog(document);
    }
    if (document.raw.doctype) {
      this.#doctype(document);
    }

    //Root element
    this.#tag({ path: [], name: "", ...document });

    //Result
    return this.#result.trim();
  }

  /** Options */
  readonly #options: StringifierOptions;

  /** Document */
  readonly #document: udocument;

  /** Debugger */
  #debug(path: string[], string: string) {
    if (this.#options.debug) {
      console.debug(`${path.join(" > ")} | ${string}`.trim());
    }
  }

  /** Prolog stringifier */
  #prolog({ raw: node }: extract) {
    this.#debug([], "stringifying prolog");
    const attributes = this.#attributes({ tag: "prolog", ...this.#make.extraction(node.xml as node) });
    this.#write(`${tokens.prolog.start}${attributes}${tokens.prolog.end}`);
  }

  /** Doctype stringifier */
  #doctype({ raw: node }: extract) {
    this.#debug([], "stringifying doctype");
    const { raw: doctype, attributes, children: elements } = this.#make.extraction(node.doctype as node);

    //Open tag
    this.#write(`${tokens.doctype.start}${this.#properties({ attributes } as extract)}`, {
      newline: !!elements.length,
    });

    //Elements
    if (elements.length) {
      this.#debug([], "stringifying doctype elements");
      this.#down();
      this.#write(tokens.doctype.elements.start);
      this.#down();
      for (const key of elements) {
        this.#debug([], `stringifying doctype elements ${key}`);
        const value = `${tokens.doctype.element.value.start}${doctype[key]}${tokens.doctype.element.value.end}`;
        this.#write(
          `${tokens.doctype.element.start} ${
            this.#quote(key, { optional: true })
          } ${value} ${tokens.doctype.element.end}`,
        );
      }
      this.#up();
      this.#write(tokens.doctype.elements.end);
      this.#up();
    }

    //Close tag
    this.#write(tokens.doctype.end);
  }

  /** Tag stringifier */
  #tag(
    { path, name, raw: node, text: content, comments, attributes, children }: extract & {
      path: string[];
      name: string;
    },
  ) {
    //Progress
    if (name) {
      this.#debug(path, `stringifying tag ${name}`);
    }
    if (this.#options.progress) {
      this.#options.progress(this.#result.length);
    }

    //Open tag
    const selfclosed = (content === null) && (!comments.length) && (!children.length);
    let inline = false;
    if (name) {
      this.#write(
        `${tokens.tag.start}${name}${
          this.#attributes({ raw: node, attributes, tag: name } as extract & { tag: string })
        }${selfclosed ? tokens.tag.close.self : ""}${tokens.tag.end}`,
      );
      this.#down();
    }

    //Handle content
    if (!selfclosed) {
      //Handle text content
      if ((["string", "boolean", "number", "undefined"].includes(typeof content)) || (content === null)) {
        this.#debug(path, `stringifying text content`);
        inline = this.#text({
          text: content,
          tag: name,
          properties: Object.fromEntries(
            attributes.map((attribute) => [attribute.substring(schema.attribute.prefix.length), node[attribute]]),
          ),
        });
      }
      //Handle comments
      if (comments.length) {
        this.#debug(path, `stringifying comments`);
        for (const comment of comments) {
          this.#comment({ text: comment, tag: name });
        }
      }
      //Handle children
      if (children.length) {
        this.#debug(path, `stringifying children`);
        this.#write("\n", { newline: false, indent: false });
        const handle = ({ child, name }: { child: unknown; name: string }) => {
          switch (true) {
            case Array.isArray(child): {
              for (const value of child as unknown[]) {
                handle({ child: value, name });
              }
              break;
            }
            case (typeof child === "object") && (!!child): {
              this.#tag({ name, path: [...path, name], ...this.#make.extraction(child as node) });
              break;
            }
            default: {
              this.#tag({ name, path: [...path, name], ...this.#make.extraction({ [schema.text]: child as literal }) });
              break;
            }
          }
        };
        for (const name of children) {
          const child = node[name];
          handle({ child, name });
        }
      }
    }

    //Close tag
    if (name) {
      this.#up();
      if (!selfclosed) {
        this.#write(`${tokens.tag.close.start}${name}${tokens.tag.close.end}`, { indent: !inline });
      }
    }
  }

  /** Comment stringifier */
  #comment({ text, tag }: { text: string; tag: string }) {
    const comment = this.#replace({ value: text, key: schema.comment, tag, properties: null });
    this.#write(`${tokens.comment.start} ${comment} ${tokens.comment.end}`);
  }

  /** Text stringifier */
  #text({ text, tag, properties }: { text: literal; tag: string; properties: Partial<node> }) {
    const lines = this.#replace({ value: text, key: schema.text, tag, properties }).split("\n");
    const inline = lines.length <= 1;
    if (inline) {
      this.#trim();
    }
    for (const line of lines) {
      this.#write(line.trimStart(), { indent: !inline, newline: !inline });
    }
    return inline;
  }

  //================================================================================

  /** Attributes stringifier */
  #attributes({ raw: node, attributes, tag }: extract & { tag: string }) {
    const stringified = attributes
      .map((key) =>
        `${key.substring(schema.attribute.prefix.length)}=${
          this.#quote(this.#replace({ key, value: node[key], tag, properties: null }))
        }`
      )
      .join(" ");
    return stringified.length ? ` ${stringified}` : "";
  }

  /** Properties stringifier */
  #properties({ attributes }: extract) {
    const stringified = attributes
      .map((key) => `${this.#quote(key.substring(schema.property.prefix.length), { optional: true })}`)
      .join(" ");
    return stringified.length ? ` ${stringified}` : "";
  }

  //================================================================================

  /** Replacer */
  #replace(
    { key, value, tag, properties }: { key: string; value: unknown; tag: string; properties: null | Partial<node> },
  ) {
    return `${
      this.#options.replacer!.call(null, {
        key,
        tag,
        properties,
        value: (() => {
          switch (true) {
            // Convert empty values to null
            case (this.#options.nullToEmpty ?? true) && (value === null):
              return "";
            // Escape XML entities
            default: {
              for (const [char, entity] of Object.entries(entities.char)) {
                value = `${value}`.replaceAll(char, entity);
              }
            }
          }
          return `${value}`;
        })(),
      })
    }`;
  }

  //================================================================================

  /** Result */
  #result = "";

  /** Write text */
  #write(text: string, { newline = true, indent = true } = {}) {
    this.#result += `${`${indent ? " ".repeat((this.#options?.indentSize ?? 2) * this.#depth) : ""}`}${text}${
      newline ? "\n" : ""
    }`;
  }

  /** Trim text */
  #trim() {
    this.#result = this.#result.trim();
  }

  /** Depth */
  #depth = 0;

  /** Go down */
  #down() {
    this.#depth++;
  }

  /** Go up */
  #up() {
    this.#depth--;
    this.#depth = Math.max(0, this.#depth);
  }

  /** Quoter */
  #quote(content: unknown, { optional = false } = {}) {
    if (optional) {
      if (/^[\w_]+$/i.test(`${content}`)) {
        return `${content}`;
      }
    }
    return `"${`${content}`.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }

  //================================================================================

  /** Makers */
  #make = {
    /** Extract content (text), attributes and children nodes */
    extraction(node: udocument | node | null) {
      const keys = Object.keys(node ?? {});
      return {
        raw: node,
        text: node?.[schema.text] ?? null,
        comments: node?.[schema.comment] ?? [],
        attributes: keys.filter((key) =>
          key.startsWith(schema.attribute.prefix) || key.startsWith(schema.property.prefix)
        ),
        children: keys.filter((key) =>
          ![schema.text, schema.comment, "xml", "doctype"].includes(key) &&
          !(key.startsWith(schema.attribute.prefix) || key.startsWith(schema.property.prefix))
        ),
        meta: node?.[$XML] ?? {},
      } as extract;
    },
  };
}
