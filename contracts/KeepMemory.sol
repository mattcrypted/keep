// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/utils/Base64.sol";

/// @title Keep Memory
/// @notice Each token is a memory the user OWNS on 0G chain. Minting also
/// notarizes the memory's 0G storage rootHash on-chain (the "anchor") — so one
/// mint = ownership (the token) + provenance (rootHash + owner + time, queryable
/// and event-logged). The token references a 0G storage record; the chain records
/// that the relayer asserted this rootHash is owned by this address as of this block
/// (the storage<->chain binding is enforced off-chain by the trusted relayer at mint).
/// `anchoredAt` is the trustless block time of the mint; `timestampOf` is the
/// record's *claimed* time and is only as trustworthy as the relayer.
contract KeepMemory is ERC721, Ownable {
    uint256 public nextId = 1;

    mapping(uint256 => bytes32) public rootHashOf;   // tokenId  -> 0G storage rootHash
    mapping(bytes32 => address) public ownerOfRoot;  // rootHash -> owner (the anchor)
    mapping(bytes32 => uint256) public tokenIdOfRoot; // rootHash -> tokenId (O(1) ownership lookup)
    mapping(uint256 => uint256) public timestampOf;  // tokenId  -> claimed record time
    mapping(uint256 => uint256) public anchoredAt;   // tokenId  -> block.timestamp at mint (trustless)
    mapping(uint256 => string) private _modelOf;     // tokenId  -> claimed model id

    /// @notice The on-chain anchor: this memory (rootHash) is owned by `owner`. `ts` is
    /// the record's claimed time; `anchoredAt` is the trustless block time of this mint.
    event MemoryAnchored(
        uint256 indexed tokenId,
        bytes32 indexed rootHash,
        address indexed owner,
        string model,
        uint256 ts,
        uint256 anchoredAt
    );

    constructor(address initialOwner)
        ERC721("Keep Memory", "KEEP")
        Ownable(initialOwner)
    {}

    /// @notice Mint a memory to its owner and anchor its 0G rootHash on-chain.
    /// @dev onlyOwner = only the app backend (the relayer) mints; it mints TO the
    /// user's address, so the user owns it without needing gas. Idempotent per rootHash.
    function mintMemory(address to, bytes32 rootHash, string calldata model, uint256 ts)
        external
        onlyOwner
        returns (uint256 tokenId)
    {
        require(to != address(0), "zero owner");
        require(ownerOfRoot[rootHash] == address(0), "already minted");

        tokenId = nextId++;
        _mint(to, tokenId); // recipients are EOAs (Privy embedded wallets)

        rootHashOf[tokenId] = rootHash;
        ownerOfRoot[rootHash] = to;
        tokenIdOfRoot[rootHash] = tokenId;
        timestampOf[tokenId] = ts;
        anchoredAt[tokenId] = block.timestamp;
        _modelOf[tokenId] = model;

        emit MemoryAnchored(tokenId, rootHash, to, model, ts, block.timestamp);
    }

    function modelOf(uint256 tokenId) external view returns (string memory) {
        _requireOwned(tokenId);
        return _modelOf[tokenId];
    }

    /// @notice On-chain JSON metadata pointing at the 0G record. Separates the
    /// record's *claimed* timestamp from the trustless block time of the anchor.
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        string memory rh = Strings.toHexString(uint256(rootHashOf[tokenId]), 32);
        string memory json = string(
            abi.encodePacked(
                '{"name":"Keep Memory #',
                Strings.toString(tokenId),
                '","description":"A memory remembered on 0G storage and owned on 0G chain. The chain records that this rootHash was anchored to this owner at the mint block.",',
                '"attributes":[',
                '{"trait_type":"rootHash","value":"', rh, '"},',
                '{"trait_type":"model","value":"', _modelOf[tokenId], '"},',
                '{"trait_type":"claimed_timestamp","value":"', Strings.toString(timestampOf[tokenId]), '"},',
                '{"trait_type":"anchored_at_block_time","value":"', Strings.toString(anchoredAt[tokenId]), '"}]}'
            )
        );
        return string(abi.encodePacked("data:application/json;base64,", Base64.encode(bytes(json))));
    }
}
