// ============================================================
// Aura PCs — Review Approval Bot
//
// What this does: watches the Discord channel where review submissions land.
// - React with ✅ to approve a review, it goes live on the site automatically.
// - React with 🗑️ to permanently delete a review, whether it's pending or
//   already live, it's removed from the database entirely (not recoverable).
//
// You do NOT need to know how to code to run this. Just follow SETUP.md.
// ============================================================

const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

// ---- Config (set these as environment variables wherever you host this) ----
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY; // NOT the anon key, the secret one
const OWNER_USER_IDS = (process.env.OWNER_USER_IDS || "632797378147254283,804723860717043822").split(",");

if (!DISCORD_BOT_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing required environment variables. Check SETUP.md.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}. Watching for review approvals.`);
});

client.on('messageReactionAdd', async (reaction, user) => {
  try {
    if (user.bot) return;

    // Only these two people can approve or delete reviews
    if (!OWNER_USER_IDS.includes(user.id)) return;

    // Handle partial reactions (Discord doesn't always send full data)
    if (reaction.partial) {
      await reaction.fetch();
    }

    const messageId = reaction.message.id;
    const emojiName = reaction.emoji.name;

    if (emojiName !== '✅' && emojiName !== '🗑️') return;

    // Find the review tied to this Discord message
    const { data: matches, error: findError } = await supabase
      .from('reviews')
      .select('id, approved, name')
      .eq('discord_message_id', messageId)
      .limit(1);

    if (findError) {
      console.error("Error looking up review:", findError.message);
      return;
    }

    if (!matches || matches.length === 0) {
      // This message isn't a tracked review, ignore silently
      return;
    }

    const review = matches[0];

    if (emojiName === '✅') {
      if (review.approved) return; // already approved, nothing to do

      const { error: updateError } = await supabase
        .from('reviews')
        .update({ approved: true })
        .eq('id', review.id);

      if (updateError) {
        console.error("Error approving review:", updateError.message);
        return;
      }

      console.log(`Approved review from ${review.name} (id: ${review.id})`);
      try {
        await reaction.message.reply(`✅ Approved by ${user.username}. This review is now live on the site.`);
      } catch (replyErr) {
        console.warn("Couldn't post confirmation reply:", replyErr.message);
      }
      return;
    }

    if (emojiName === '🗑️') {
      const { error: deleteError } = await supabase
        .from('reviews')
        .delete()
        .eq('id', review.id);

      if (deleteError) {
        console.error("Error deleting review:", deleteError.message);
        return;
      }

      console.log(`Deleted review from ${review.name} (id: ${review.id})`);
      try {
        await reaction.message.reply(`🗑️ Deleted by ${user.username}. This review has been permanently removed, including from the site if it was already live.`);
      } catch (replyErr) {
        console.warn("Couldn't post confirmation reply:", replyErr.message);
      }
      return;
    }

  } catch (err) {
    console.error("Unexpected error handling reaction:", err);
  }
});

client.login(DISCORD_BOT_TOKEN);
