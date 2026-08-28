import { Option, Schema } from "effect";

import { TikTokEvent, type TransportEvent } from "./Definition.ts";

const Count = Schema.Union([
  Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  Schema.String.check(Schema.isPattern(/^\d+$/)),
  Schema.BigInt.check(Schema.isGreaterThanOrEqualToBigInt(0n)),
]);
const Id = Schema.Union([Schema.String, Schema.Int, Schema.BigInt]);
const Text = Schema.optional(Schema.String);
const NumberField = Schema.optional(Count);
const User = Schema.Struct({
  uniqueId: Text,
  displayId: Text,
  nickname: Text,
  userId: Schema.optional(Id),
  id: Schema.optional(Id),
});
const DisplayText = Schema.Struct({ defaultPattern: Text, key: Text });
const Question = Schema.Struct({
  questionText: Text,
  content: Text,
  questionId: Schema.optional(Id),
  user: Schema.optional(User),
});
// Both the Electron/Euler payloads and the pinned connector's native v3 protobuf names.
const Payload = Schema.Struct({
  uniqueId: Text,
  nickname: Text,
  userId: Schema.optional(Id),
  user: Schema.optional(User),
  fromUserId: Schema.optional(Id),
  host: Schema.optional(User),
  comment: Text,
  content: Schema.optional(Schema.Union([Schema.String, DisplayText])),
  common: Schema.optional(Schema.Struct({ displayText: Schema.optional(DisplayText) })),
  commonBarrageContent: Schema.optional(DisplayText),
  giftId: Schema.optional(Id),
  giftType: NumberField,
  diamondCount: NumberField,
  repeatCount: NumberField,
  repeatEnd: Schema.optional(Schema.Union([Schema.Boolean, Schema.Literals([0, 1])])),
  extendedGiftInfo: Schema.optional(
    Schema.Struct({
      name: Text,
      diamondCount: NumberField,
      diamond_count: NumberField,
    }),
  ),
  giftDetails: Schema.optional(
    Schema.Struct({
      giftName: Text,
      giftType: NumberField,
      diamondCount: NumberField,
    }),
  ),
  gift: Schema.optional(
    Schema.Struct({
      id: Schema.optional(Id),
      name: Text,
      type: NumberField,
      diamondCount: NumberField,
      gift_name: Text,
      gift_type: NumberField,
      diamond_count: NumberField,
    }),
  ),
  likeCount: NumberField,
  totalLikeCount: NumberField,
  count: NumberField,
  total: NumberField,
  memberCount: NumberField,
  viewerCount: NumberField,
  details: Schema.optional(Question),
  data: Schema.optional(Question),
  emoteList: Schema.optional(Schema.Array(Schema.Struct({ emoteId: Id }))),
  envelopeInfo: Schema.optional(
    Schema.Struct({
      envelopeId: Id,
      sendUserName: Text,
      sendUserId: Schema.optional(Id),
      diamondCount: NumberField,
      peopleCount: NumberField,
    }),
  ),
  description: Text,
  battleId: Schema.optional(Id),
  giftCount: NumberField,
  totalDiamondCount: NumberField,
  action: NumberField,
  shareType: Schema.optional(Schema.NullOr(Id)),
  displayStyle: NumberField,
  goal: Schema.optional(Schema.Struct({ description: Text })),
  contributorDisplayId: Text,
  contributorIdStr: Text,
  contributorId: Schema.optional(Id),
  contributeCount: NumberField,
  contributeScore: NumberField,
});

const firstId = (...values: ReadonlyArray<string | number | bigint | undefined>) =>
  values.map((value) => String(value ?? "")).find((value) => value !== "" && value !== "0") ?? "";

export function decodeEvent(kind: TransportEvent, input: unknown): TikTokEvent | undefined {
  const result = Schema.decodeUnknownOption(Payload)(input);
  if (Option.isNone(result)) return;
  const data = result.value;
  const question = data.details ?? data.data;
  const identity = data.user ?? data.host ?? question?.user;
  let user = data.uniqueId || identity?.uniqueId || identity?.displayId || "";
  let userId = firstId(
    data.userId,
    identity?.userId,
    identity?.id,
    kind === "linkMicArmies" ? data.fromUserId : undefined,
  );
  const giftType = Number(
    data.giftType ?? data.giftDetails?.giftType ?? data.gift?.type ?? data.gift?.gift_type ?? 0,
  );
  const repeatEnd = data.repeatEnd === true || data.repeatEnd === 1;
  let eventKind: TikTokEvent["kind"];
  if (kind === "social") {
    const key = data.common?.displayText?.key ?? "";
    // Do not treat arbitrary social messages as follows (the Electron bridge did).
    if (
      key.includes("share") ||
      Number(data.action) === 3 ||
      Number(data.displayStyle) === 2 ||
      (data.shareType !== undefined && Number(data.shareType) !== 0)
    )
      eventKind = "share";
    else if (key.includes("follow") || Number(data.action) === 1) eventKind = "follow";
    else return;
  } else eventKind = kind === "gift" && giftType === 1 && !repeatEnd ? "giftStreak" : kind;

  switch (kind) {
    case "chat":
      if (data.comment === undefined && typeof data.content !== "string") return;
      break;
    case "gift":
      if (
        data.giftId === undefined &&
        data.gift === undefined &&
        data.giftDetails === undefined &&
        data.extendedGiftInfo === undefined
      )
        return;
      break;
    case "member":
    case "follow":
    case "share":
    case "social":
      if (!user && !userId) return;
      break;
    case "like":
      if (data.likeCount === undefined && data.count === undefined) return;
      break;
    case "roomUser":
      if (data.viewerCount === undefined && data.total === undefined) return;
      break;
    case "questionNew":
      if (question?.questionText === undefined && question?.content === undefined) return;
      break;
    case "emote":
      if (!data.emoteList) return;
      break;
    case "envelope":
      if (!data.envelopeInfo) return;
      user = data.envelopeInfo.sendUserName || user;
      userId = firstId(data.envelopeInfo.sendUserId, userId);
      break;
    case "liveIntro":
      if (data.description === undefined && typeof data.content !== "string") return;
      break;
    case "linkMicBattle":
    case "linkMicArmies":
      if (data.battleId === undefined) return;
      break;
    case "superFan":
    case "superFanJoin":
      if (!data.content && !data.commonBarrageContent) return;
      break;
    case "streamEnd":
      if (data.action === undefined) return;
      break;
    case "goalUpdate":
      if (!data.goal) return;
      break;
    case "roomMessage":
      if (typeof data.content !== "string") return;
      break;
  }
  const numbers = {
    giftType,
    diamonds: Number(
      data.envelopeInfo?.diamondCount ??
        data.extendedGiftInfo?.diamondCount ??
        data.extendedGiftInfo?.diamond_count ??
        data.giftDetails?.diamondCount ??
        data.gift?.diamondCount ??
        data.gift?.diamond_count ??
        data.diamondCount ??
        0,
    ),
    repeatCount: Number(data.repeatCount ?? 1),
    likeCount: Number(data.likeCount ?? data.count ?? 0),
    totalLikeCount: Number(data.totalLikeCount ?? (kind === "like" ? data.total : 0) ?? 0),
    memberCount: Number(data.memberCount ?? 0),
    viewerCount: Number(data.viewerCount ?? (kind === "roomUser" ? data.total : 0) ?? 0),
    peopleCount: Number(data.envelopeInfo?.peopleCount ?? 0),
    giftCount: Number(data.giftCount ?? 0),
    totalDiamondCount: Number(data.totalDiamondCount ?? 0),
    action: Number(data.action ?? 0),
    contributeCount: Number(data.contributeCount ?? 0),
    contributeScore: Number(data.contributeScore ?? 0),
  };
  if (Object.values(numbers).some((value) => !Number.isSafeInteger(value) || value < 0)) return;
  let payloadJson: string;
  try {
    payloadJson = JSON.stringify(input, (_, value: unknown) =>
      typeof value === "bigint" ? String(value) : value,
    );
  } catch {
    return;
  }
  if (typeof payloadJson !== "string" || payloadJson.length > 1_048_576) return;
  return new TikTokEvent({
    ...numbers,
    kind: eventKind,
    user,
    userId,
    nickname: data.nickname || identity?.nickname || "",
    comment: data.comment ?? (typeof data.content === "string" ? data.content : ""),
    giftId: firstId(data.giftId, data.gift?.id),
    giftName:
      data.extendedGiftInfo?.name ??
      data.giftDetails?.giftName ??
      data.gift?.name ??
      data.gift?.gift_name ??
      "Gift",
    repeatEnd,
    question: question?.questionText ?? question?.content ?? "",
    questionId: String(question?.questionId ?? ""),
    emoteIdsJson: JSON.stringify(data.emoteList?.map((emote) => String(emote.emoteId)) ?? []),
    envelopeId: String(data.envelopeInfo?.envelopeId ?? ""),
    description:
      data.description ??
      data.goal?.description ??
      (typeof data.content === "string" ? data.content : ""),
    battleId: String(data.battleId ?? ""),
    message:
      typeof data.content === "string"
        ? data.content
        : (data.content?.defaultPattern ?? data.commonBarrageContent?.defaultPattern ?? ""),
    contributor: firstId(data.contributorDisplayId, data.contributorIdStr, data.contributorId),
    payloadJson,
  });
}
