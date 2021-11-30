const { expect } = require("chai");

const sourceOfTruth = require("../sdk/_abi/sourceOfTruth");

describe("sdk/_abi", () => {
  for (const { filename, data: expected } of sourceOfTruth) {
    it(`${filename} is up to date`, async () => {
      if (!filename.match(/^[A-Za-z0-9_-]*\.js$/)) {
        throw new Error("bad filename: " + filename);
      }
      const modulePath = "../sdk/_abi/" + filename;
      expect(require(modulePath)).to.deep.equal(expected);
    });
  }
});
