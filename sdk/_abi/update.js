const fs = require("fs");
const { join } = require("path");
const util = require("util");

const prettier = require("prettier");

const sourceOfTruth = require("./sourceOfTruth");

function fileContents(data) {
  const raw = `module.exports = ${JSON.stringify(data)};`;
  return prettier.format(raw, { parser: "babel" });
}

async function updateAbi() {
  await Promise.all(
    sourceOfTruth.map(({ filename, data }) =>
      util.promisify(fs.writeFile)(
        join(__dirname, filename),
        fileContents(data)
      )
    )
  );
}

module.exports = updateAbi;
