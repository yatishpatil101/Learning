export const SHARE_OPENER = {
  solo: "Hi! I'm interested in the room you listed. Is it still available?",
  bring: "Hi! I'm interested in this room and I'd be taking it with someone I know — so two of us in total. Is it still available?",
  match: "Hi! I'm interested in this room and I'd like to split it with another flatmate. Is it still available, and are you open to two people sharing it?",
};

export const SEEKER_OPENER = "Hi! I'm interested in sharing a flat. Let's connect.";

export const groupOpener = (g) => (g.policy === 'any'
  ? "Hi! I'd love to join your flatmate group. When can I move in?"
  : "Hi! I'd like to request a spot in your flatmate group — is it still open?");
