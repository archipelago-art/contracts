const { expect } = require("chai");
const { ethers } = require("hardhat");

const SignatureKind = Object.freeze({
  ETHEREUM_SIGNED_MESSAGE: 0,
  EIP_712: 1,
});

describe("SignatureChecker", () => {
  let SignatureCheckerFixture;
  let fixture;
  before(async () => {
    SignatureCheckerFixture = await ethers.getContractFactory(
      "SignatureCheckerFixture"
    );
    fixture = await SignatureCheckerFixture.deploy();
    await fixture.deployed();
  });

  function stringHash(s) {
    return ethers.utils.keccak256(ethers.utils.toUtf8Bytes(s));
  }

  const TYPED_DOMAIN_SEPARATOR = Object.freeze({
    name: "SampleDomain",
    version: "1",
  });
  const TYPEHASH_DOMAIN_SEPARATOR = stringHash(
    "EIP712Domain(string name,string version)"
  );
  const RAW_DOMAIN_SEPARATOR = ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ["bytes32", "bytes32", "bytes32"],
      [TYPEHASH_DOMAIN_SEPARATOR, stringHash("SampleDomain"), stringHash("1")]
    )
  );

  const TYPES = Object.freeze({
    Prism: [
      { type: "Point2d[]", name: "footprint" },
      { type: "uint256", name: "height" },
    ],
    Point2d: [
      { type: "uint256", name: "x" },
      { type: "uint256", name: "y" },
    ],
  });
  const TYPEHASH_PRISM = stringHash(
    "Prism(Point2d[] footprint,uint256 height)Point2d(uint256 x,uint256 y)"
  );
  const TYPEHASH_POINT_2D = stringHash("Point2d(uint256 x,uint256 y)");

  function prismStructHash(prism) {
    return ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(
        ["bytes32", "bytes32", "uint256"],
        [
          TYPEHASH_PRISM,
          ethers.utils.keccak256(
            ethers.utils.concat(prism.footprint.map(point2dStructHash))
          ),
          prism.height,
        ]
      )
    );
  }
  function point2dStructHash(point) {
    return ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(
        ["bytes32", "uint256", "uint256"],
        [TYPEHASH_POINT_2D, point.x, point.y]
      )
    );
  }

  it("verifies an Ethereum signed message", async () => {
    const signer = (await ethers.getSigners())[0];
    const prism = {
      footprint: [
        { x: 0, y: 0 },
        { x: 1, y: 2 },
        { x: 2, y: 0 },
      ],
      height: 7,
    };
    const structHash = prismStructHash(prism);
    const message = ethers.utils.arrayify(
      ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["bytes32", "bytes32"],
          [RAW_DOMAIN_SEPARATOR, structHash]
        )
      )
    );
    const signature = await signer.signMessage(message);
    expect(
      await fixture.recover(
        RAW_DOMAIN_SEPARATOR,
        structHash,
        signature,
        SignatureKind.ETHEREUM_SIGNED_MESSAGE
      )
    ).to.equal(signer.address);
  });

  it("verifies a typed data signature", async () => {
    const signer = (await ethers.getSigners())[0];
    const prism = {
      footprint: [
        { x: 0, y: 0 },
        { x: 1, y: 2 },
        { x: 2, y: 0 },
      ],
      height: 7,
    };
    const signature = await signer._signTypedData(
      TYPED_DOMAIN_SEPARATOR,
      TYPES,
      prism
    );
    expect(
      await fixture.recover(
        RAW_DOMAIN_SEPARATOR,
        prismStructHash(prism),
        signature,
        SignatureKind.EIP_712
      )
    ).to.equal(signer.address);
  });
});
