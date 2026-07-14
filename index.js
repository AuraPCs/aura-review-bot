// ============================================================
// Aura PCs — Review Approval Bot
//
// What this does: watches the Discord channel where review submissions land.
// When you (or the other owner) react with ✅ on a review message, the bot
// flips that review's "approved" flag to true in Supabase. The website then
// picks it up automatically on next page load, no code changes needed per review.
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

    // Only these two people can approve reviews
    if (!OWNER_USER_IDS.includes(user.id)) return;

    // Only the checkmark emoji counts as approval
    if (reaction.emoji.name !== '✅') return;

    // Handle partial reactions (Discord doesn't always send full data)
    if (reaction.partial) {
      await reaction.fetch();
    }

    const messageId = reaction.message.id;

    // Find the pending review tied to this Discord message
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

    if (review.approved) {
      // Already approved, nothing to do
      return;
    }

    const { error: updateError } = await supabase
      .from('reviews')
      .update({ approved: true })
      .eq('id', review.id);

    if (updateError) {
      console.error("Error approving review:", updateError.message);
      return;
    }

    console.log(`Approved review from ${review.name} (id: ${review.id})`);

    // Let the channel know it worked
    try {
      await reaction.message.reply(`✅ Approved by ${user.username}. This review is now live on the site.`);
    } catch (replyErr) {
      // Non-critical if this fails, the approval itself already succeeded
      console.warn("Couldn't post confirmation reply:", replyErr.message);
    }

  } catch (err) {
    console.error("Unexpected error handling reaction:", err);
  }
});

client.login(DISCORD_BOT_TOKEN);
