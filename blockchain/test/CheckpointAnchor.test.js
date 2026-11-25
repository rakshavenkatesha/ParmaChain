const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

const CID = 2026;
const h = (s) => ethers.id(s);

async function fixture() {
  const [owner, member, outsider] = await ethers.getSigners();
  const anchor = await ethers.deployContract("CheckpointAnchor");
  await anchor.setPublisher(member.address, true);
  return { anchor, owner, member, outsider };
}

describe("CheckpointAnchor (public-chain audit trail)", function () {
  it("only authorised publishers can anchor; owner manages publishers", async function () {
    const { anchor, outsider } = await loadFixture(fixture);
    await expect(anchor.connect(outsider).submitCheckpoint(CID, 20, h("b20"), h("s20"), h("v"))).to.be.revertedWith("Not an authorised publisher");
    await expect(anchor.connect(outsider).setPublisher(outsider.address, true)).to.be.revertedWith("Only owner");
  });

  it("stores checkpoints per height and returns latest / recent", async function () {
    const { anchor, member } = await loadFixture(fixture);
    await expect(anchor.connect(member).submitCheckpoint(CID, 20, h("b20"), h("s20"), h("v"))).to.emit(anchor, "CheckpointAnchored");
    await anchor.connect(member).submitCheckpoint(CID, 40, h("b40"), h("s40"), h("v"));
    expect(await anchor.checkpointCount(CID)).to.equal(2);
    expect((await anchor.latestCheckpoint(CID)).blockHash).to.equal(h("b40"));
    expect((await anchor.getCheckpoint(CID, 20)).stateRoot).to.equal(h("s20"));
    const recent = await anchor.recentCheckpoints(CID, 10);
    expect(recent.map((c) => Number(c.blockNumber))).to.deep.equal([40, 20]);
  });

  it("heights must increase per consortium chain", async function () {
    const { anchor, member } = await loadFixture(fixture);
    await anchor.connect(member).submitCheckpoint(CID, 40, h("b40"), h("s"), h("v"));
    await expect(anchor.connect(member).submitCheckpoint(CID, 20, h("b20"), h("s"), h("v"))).to.be.revertedWith("Checkpoints must be increasing");
    // a different consortium chain has its own sequence
    await anchor.connect(member).submitCheckpoint(31337, 5, h("x"), h("s"), h("v"));
  });

  it("a conflicting hash for an anchored height is recorded as equivocation, never overwritten", async function () {
    const { anchor, owner, member } = await loadFixture(fixture);
    await anchor.connect(member).submitCheckpoint(CID, 20, h("b20"), h("s"), h("v"));
    await expect(anchor.connect(member).submitCheckpoint(CID, 20, h("b20"), h("s"), h("v"))).to.be.revertedWith("Checkpoint already anchored");
    await expect(anchor.connect(owner).submitCheckpoint(CID, 20, h("rewritten"), h("s"), h("v")))
      .to.emit(anchor, "Equivocation")
      .withArgs(CID, 20, h("b20"), h("rewritten"), owner.address);
    expect((await anchor.getCheckpoint(CID, 20)).blockHash).to.equal(h("b20"));
    expect(await anchor.equivocationCount()).to.equal(1);
    expect((await anchor.getEquivocation(0)).conflictingHash).to.equal(h("rewritten"));
  });
});
