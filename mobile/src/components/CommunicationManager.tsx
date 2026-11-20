import { useEffect, useRef, useState } from "react";
import {
  AppState,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  communicationDraft,
  createCommunicationPlanner,
  publicCommunicationInput,
  PUBLIC_COMMUNICATION_CASES,
  reviewedCommunication,
  communicationFeedback,
  type CommunicationKind,
  type ReviewedCommunication,
  type PlanningContext,
} from "@contexify/assistant-core";
import { createCommunicationCompanion } from "../services/assistant_communications";
import type { AppTheme } from "../theme/colors";

/** No private field is sent to a planner, chat, analytics, storage or backend. */
export function CommunicationManager({
  userId,
  theme,
  onClose,
  planningConnect,
  initialRequest,
}: {
  userId: string;
  theme: AppTheme;
  onClose(): void;
  planningConnect?: (signal: AbortSignal) => Promise<PlanningContext>;
  initialRequest?: {
    text: string;
    consent: true;
    createdAt: number;
    ownerUserId: string;
  } | null;
}) {
  const insets = useSafeAreaInsets();
  const [kind, setKind] = useState<CommunicationKind>("dial");
  const [number, setNumber] = useState("");
  const [body, setBody] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [aiText, setAIText] = useState(initialRequest?.text ?? "");
  const [aiConsent, setAIConsent] = useState(false);
  const planner = useRef<ReturnType<typeof createCommunicationPlanner> | null>(
    null,
  );
  const planningAccess = useRef(planningConnect);
  planningAccess.current = planningConnect;
  const aiRequest = useRef<AbortController | null>(null);
  const prepared = useRef<ReviewedCommunication | null>(null);
  const initialConsumed = useRef(false);
  const [support, setSupport] = useState({
    picker: false,
    dial: false,
    sms: false,
  });
  const companion = useRef<ReturnType<
    typeof createCommunicationCompanion
  > | null>(null);
  const generation = useRef(0);
  const mounted = useRef(false);
  const pending = useRef(false);
  useEffect(() => {
    const port = createCommunicationCompanion();
    companion.current = port;
    mounted.current = true;
    const ai = planningAccess.current
      ? createCommunicationPlanner(async (signal) => {
          const access = planningAccess.current;
          if (!access) throw new Error("AI planning is unavailable.");
          const context = await access(signal);
          if (context.userId !== userId || context.deviceId === null)
            throw new Error(
              "Enroll this account and phone before AI planning.",
            );
          return context;
        })
      : null;
    planner.current = ai;
    setAIConsent(false);
    setAIText(
      initialRequest?.ownerUserId === userId ? initialRequest.text : "",
    );
    setNumber("");
    setBody("");
    setMessage("");
    let valid = true;
    void port.support().then((value) => {
      if (valid) {
        setSupport(value);
        if (
          !initialConsumed.current &&
          initialRequest?.consent === true &&
          initialRequest.ownerUserId === userId &&
          AppState.currentState === "active" &&
          Date.now() >= initialRequest.createdAt &&
          Date.now() - initialRequest.createdAt < 5000 &&
          port.planningSupported()
        ) {
          initialConsumed.current = true;
          setAIConsent(true);
          void runAI(initialRequest.text, true);
        }
      }
    });
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") return;
      const picking = Platform.OS === "android" && port.isPicking();
      if (!picking) {
        generation.current++;
        aiRequest.current?.abort();
        prepared.current = null;
      }
      ai?.close();
      setAIConsent(false);
      setAIText("");
      port.background();
      setNumber("");
      setBody("");
      setMessage(
        picking
          ? "Only the number you select in Contacts can return here. A prepared AI request continues only to an exact native review; nothing is called or sent automatically."
          : "Private fields cleared. Check the phone app for any request you already approved. Nothing will retry automatically.",
      );
    });
    return () => {
      valid = false;
      mounted.current = false;
      generation.current++;
      aiRequest.current?.abort();
      ai?.close();
      planner.current = null;
      prepared.current = null;
      listener.remove();
      port.dispose();
      companion.current = null;
    };
  }, [userId]);
  function current(ticket: number) {
    return (
      mounted.current &&
      ticket === generation.current &&
      AppState.currentState === "active"
    );
  }
  function stop() {
    generation.current++;
    aiRequest.current?.abort();
    planner.current?.close();
    companion.current?.cancel();
    prepared.current = null;
    setNumber("");
    setBody("");
    setAIText("");
    setAIConsent(false);
    setMessage("");
    setBusy(false);
  }
  async function continuePrepared(
    value: ReviewedCommunication,
    ticket: number,
    content: string,
    selectedNumber: string,
  ) {
    const port = companion.current;
    if (
      !port?.planningSupported() ||
      value.ownerUserId !== userId ||
      value.expiresAt <= Date.now()
    )
      throw new Error(
        "The prepared request expired or needs an updated native build. Send a fresh command.",
      );
    // Validate private message content before opening Contacts. No private field goes to the planner.
    communicationDraft({
      kind: value.kind,
      number: "+12025550123",
      body: content,
    });
    setMessage(
      "Choose one recipient locally, then review the exact phone confirmation.",
    );
    const recipient = selectedNumber.trim() || (await port.pickNumber());
    if (!current(ticket)) return;
    if (!recipient) {
      prepared.current = null;
      setMessage(
        "Recipient selection cancelled or unavailable. Nothing was opened.",
      );
      return;
    }
    if (value.expiresAt <= Date.now())
      throw new Error(
        "The AI proposal expired during selection. Send a fresh command.",
      );
    let draft;
    try {
      draft = communicationDraft({
        kind: value.kind,
        number: recipient,
        body: content,
      });
    } catch {
      setNumber(recipient);
      setBody(content);
      setMessage(
        "Complete the international number with + and its country code below, then review. No country code was guessed.",
      );
      return;
    }
    prepared.current = null;
    setNumber("");
    setBody("");
    const result = await port.open(draft, value.expiresAt);
    if (current(ticket)) setMessage(result);
  }
  async function runAI(text = aiText, consent = aiConsent) {
    if (
      pending.current ||
      !consent ||
      !planner.current ||
      !companion.current?.planningSupported() ||
      AppState.currentState !== "active"
    )
      return;
    try {
      publicCommunicationInput(text);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Use a public example. Private text was not sent.",
      );
      return;
    }
    const request = new AbortController();
    aiRequest.current = request;
    const ticket = generation.current;
    pending.current = true;
    setBusy(true);
    prepared.current = null;
    setNumber("");
    setBody("");
    setMessage("Understanding the public test command...");
    try {
      const response = await planner.current.plan(text, request.signal);
      if (!current(ticket) || request.signal.aborted) return;
      aiRequest.current = null;
      const review = reviewedCommunication(response);
      if (!review || response.proposal.status !== "communication_proposed") {
        if (response.proposal.status !== "communication_proposed")
          setMessage(communicationFeedback(response.proposal));
        return;
      }
      prepared.current = review;
      setKind(review.kind);
      setBody(review.body ?? "");
      if (review.body === null) {
        setMessage(
          "Enter the missing message privately below, then review the prepared request. It will stay on this phone.",
        );
        return;
      }
      await continuePrepared(review, ticket, review.body, "");
    } catch (error) {
      if (current(ticket)) {
        prepared.current = null;
        setMessage(
          error instanceof Error
            ? error.message
            : "AI preparation unavailable. Nothing was opened.",
        );
      }
    } finally {
      request.abort();
      if (aiRequest.current === request) aiRequest.current = null;
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function reviewPrepared() {
    const value = prepared.current;
    if (!value || pending.current || AppState.currentState !== "active") return;
    pending.current = true;
    setBusy(true);
    const ticket = generation.current;
    try {
      await continuePrepared(value, ticket, value.body ?? body, number);
    } catch (error) {
      if (current(ticket)) {
        prepared.current = null;
        setMessage(
          error instanceof Error
            ? error.message
            : "Prepared request unavailable.",
        );
      }
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function run(pick: boolean) {
    if (
      pending.current ||
      !companion.current ||
      AppState.currentState !== "active"
    )
      return;
    const port = companion.current;
    const ticket = generation.current;
    // Validate synchronously so an invalid number never starts a native request.
    let draft;
    try {
      if (!pick)
        draft = communicationDraft({
          kind,
          number,
          body: kind === "dial" ? "" : body,
        });
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Review the private fields.",
      );
      return;
    }
    pending.current = true;
    setBusy(true);
    setMessage("");
    try {
      if (pick) {
        const selected = await port.pickNumber();
        if (
          mounted.current &&
          ticket === generation.current &&
          AppState.currentState === "active"
        ) {
          if (selected !== null) setNumber(selected);
          setMessage(
            selected === null
              ? "Contact selection cancelled or unavailable."
              : "Review the selected number, including its country code. This did not start a call or message.",
          );
        }
      } else {
        const result = await port.open(draft!);
        if (
          mounted.current &&
          ticket === generation.current &&
          AppState.currentState === "active"
        ) {
          setNumber("");
          setBody("");
          setMessage(result);
        }
      }
    } catch (error) {
      if (
        mounted.current &&
        ticket === generation.current &&
        AppState.currentState === "active"
      )
        setMessage(
          error instanceof Error
            ? error.message
            : "Request unavailable. Check the phone app before trying again.",
        );
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function close() {
    stop();
    onClose();
  }
  function button(
    label: string,
    press: () => void,
    disabled = busy,
    selected = false,
  ) {
    return (
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityState={{ disabled, selected }}
        disabled={disabled}
        onPress={press}
        style={{
          minHeight: 44,
          padding: 12,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: theme.borderSubtle,
          opacity: disabled ? 0.45 : 1,
        }}
      >
        <Text style={{ color: theme.textMain, fontWeight: "600" }}>
          {label}
          {selected ? " (selected)" : ""}
        </Text>
      </TouchableOpacity>
    );
  }
  return (
    <Modal visible transparent animationType="fade" onRequestClose={close}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{
          flex: 1,
          justifyContent: "center",
          backgroundColor: "rgba(0,0,0,0.65)",
          padding: 16,
          paddingTop: insets.top + 16,
          paddingBottom: insets.bottom + 16,
        }}
      >
        <View
          style={{
            maxHeight: "100%",
            borderRadius: 18,
            padding: 18,
            gap: 12,
            backgroundColor: theme.bgCard,
          }}
        >
          <Text
            accessibilityRole="header"
            style={{ color: theme.textMain, fontSize: 21, fontWeight: "700" }}
          >
            Calls and messages
          </Text>
          {button("Back", close, false)}
          <ScrollView
            style={{ flexShrink: 1 }}
            contentContainerStyle={{ gap: 12, paddingBottom: 12 }}
            keyboardShouldPersistTaps="handled"
          >
            {planningConnect && (
              <View style={{ gap: 10 }}>
                <Text style={{ color: theme.textMain, fontWeight: "600" }}>
                  AI command flow — public test examples
                </Text>
                <Text style={{ color: theme.textMuted }}>
                  Use an example below. This build sends only approved public
                  text to AI. Real recipient numbers and locally completed
                  message fields stay on this phone.
                </Text>
                {button(
                  `${aiConsent ? "☑" : "☐"} Allow AI processing of public test text this session`,
                  () => {
                    if (aiConsent) stop();
                    else setAIConsent(true);
                  },
                  false,
                  aiConsent,
                )}
                <TextInput
                  accessibilityLabel="Public communication command"
                  value={aiText}
                  onChangeText={(text) => {
                    setAIText(text);
                    prepared.current = null;
                  }}
                  editable={!busy}
                  maxLength={1024}
                  multiline
                  autoCorrect={false}
                  style={{
                    color: theme.textMain,
                    minHeight: 90,
                    borderWidth: 1,
                    borderColor: theme.borderSubtle,
                    borderRadius: 10,
                    padding: 12,
                  }}
                />
                {button("Use phone-call example", () => {
                  prepared.current = null;
                  setAIText(PUBLIC_COMMUNICATION_CASES["M7-01"]);
                })}
                {button("Use message example", () => {
                  prepared.current = null;
                  setAIText(PUBLIC_COMMUNICATION_CASES["M7-03"]);
                })}
                {button("Use missing-message example", () => {
                  prepared.current = null;
                  setAIText(PUBLIC_COMMUNICATION_CASES["M7-10"]);
                })}
                {button(
                  busy
                    ? "Preparing or waiting for phone..."
                    : "Send public command",
                  () => {
                    void runAI();
                  },
                  busy || !aiConsent || !companion.current?.planningSupported(),
                )}
                {button("Clear / cancel request", stop, false)}
                {!companion.current?.planningSupported() && (
                  <Text style={{ color: theme.textMuted }}>
                    AI handoffs need the updated native test build. Private
                    manual entry remains below.
                  </Text>
                )}
              </View>
            )}
            <Text style={{ color: theme.textMuted }}>
              Select one number or enter it with its country code. Review the
              exact number and message in the phone confirmation. You make the
              final Call or Send choice in the phone app. Charges may apply.
            </Text>
            <Text style={{ color: theme.textMuted }}>
              These private fields stay out of chat, Gemini and Contexify
              storage. The phone app receives them only after approval and may
              retain drafts, messages or call history. Signing out here cannot
              remove those external records. This is not an emergency service.
            </Text>
            {button(
              "Phone call",
              () => {
                prepared.current = null;
                setKind("dial");
                setBody("");
                setMessage("");
              },
              busy,
              kind === "dial",
            )}
            {button(
              "Text message",
              () => {
                prepared.current = null;
                setKind("sms");
                setMessage("");
              },
              busy,
              kind === "sms",
            )}
            {button(
              "Choose one contact number",
              () => {
                void run(true);
              },
              busy || !support.picker,
            )}
            <Text style={{ color: theme.textMain }}>
              International phone number
            </Text>
            <TextInput
              accessibilityLabel="International phone number"
              value={number}
              onChangeText={setNumber}
              editable={!busy}
              maxLength={64}
              keyboardType="phone-pad"
              autoComplete="off"
              autoCorrect={false}
              style={{
                color: theme.textMain,
                borderWidth: 1,
                borderColor: theme.borderSubtle,
                borderRadius: 10,
                padding: 12,
              }}
            />
            {kind === "sms" && (
              <>
                <Text style={{ color: theme.textMain }}>
                  Message to review (maximum 1000 characters)
                </Text>
                <TextInput
                  accessibilityLabel="Message to review"
                  value={body}
                  onChangeText={(text) => {
                    setBody(text);
                    if (prepared.current?.body !== null)
                      prepared.current = null;
                  }}
                  editable={!busy}
                  maxLength={1000}
                  multiline
                  autoComplete="off"
                  autoCorrect={false}
                  style={{
                    color: theme.textMain,
                    minHeight: 110,
                    textAlignVertical: "top",
                    borderWidth: 1,
                    borderColor: theme.borderSubtle,
                    borderRadius: 10,
                    padding: 12,
                  }}
                />
              </>
            )}
            {!support[kind] && (
              <Text style={{ color: theme.textMuted }}>
                This action needs a compatible native test build and an
                available phone app. Use Contacts, Phone or Messages directly.
                iPhone SMS composition also requires messaging support on the
                device.
              </Text>
            )}
            {button(
              busy
                ? "Waiting for phone..."
                : kind === "dial"
                  ? "Review phone request"
                  : "Review message request",
              () => {
                if (prepared.current) void reviewPrepared();
                else void run(false);
              },
              busy || !support[kind],
            )}
            <Text
              accessibilityLiveRegion="polite"
              style={{ color: theme.textMain }}
            >
              {message}
            </Text>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
