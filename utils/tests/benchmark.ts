//Imports
import { bench, runBenchmarks } from "https://deno.land/std@0.111.0/testing/bench.ts";
import { expandGlob } from "https://deno.land/std@0.111.0/fs/expand_glob.ts";
import { parse } from "../../mod.ts";

//Huge xml file generator
async function write({ path, size }: { path: string; size: number }) {
  const file = await Deno.open(path, { write: true, truncate: true, create: true });
  const encoder = new TextEncoder();
  await Deno.write(file.rid, encoder.encode("<root>"));
  for (let i = 0; i < size * 3100; i++) {
    await Deno.write(file.rid, encoder.encode(`<child>${Math.random()}</child>`));
  }
  await Deno.write(file.rid, encoder.encode("</root>"));
}
await write({ path: "utils/tests/assets/x-large.xml", size: 0.2 });
await write({ path: "utils/tests/assets/x-xlarge.xml", size: 0.5 });
await write({ path: "utils/tests/assets/x-xxlarge.xml", size: 1 });

//Benchmarks
for await (const { name, path } of expandGlob("**/*.xml", { globstar: true })) {
  const { size } = await (await Deno.open(path)).stat();
  for (const mode of (size > 2 ** 13 ? ["stream"] : ["stream", "text"])) {
    bench({
      name: `parse: ${name} (${mode}, ${size}b)`,
      runs: 50,
      async func(t) {
        const content = mode === "stream" ? await Deno.open(path) : await Deno.readTextFile(path);
        t.start();
        parse(content);
        t.stop();
      },
    });
  }
}
runBenchmarks();
