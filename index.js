// ============================================================
// Aura PCs — Review Approval Bot (debug version)
//
// Temporarily includes extra console.log lines so we can see exactly what
// the bot receives when you react. Once everything's confirmed working,
// these can be removed (not required, just noisy in the logs long-term).
// ============================================================

const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
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
  console.log("=== Reaction event received ===");
  console.log("User:", user.tag, user.id, "Bot?", user.bot);
  console.log("Emoji:", reaction.emoji.name);

  try {
    if (user.bot) {
      console.log("Ignoring: reaction came from a bot.");
      return;
    }

    if (!OWNER_USER_IDS.includes(user.id)) {
      console.log("Ignoring: user id not in OWNER_USER_IDS list:", OWNER_USER_IDS);
      return;
    }

    if (reaction.partial) {
      console.log("Reaction was partial, fetching full data...");
      await reaction.fetch();
    }
    if (reaction.message.partial) {
      console.log("Message was partial, fetching full data...");
      await reaction.message.fetch();
    }

    const emojiName = reaction.emoji.name;
    if (emojiName !== '✅' && emojiName !== '🗑️') {
      console.log("Ignoring: emoji is not ✅ or 🗑️, it's:", emojiName);
      return;
    }

    const embed = reaction.message.embeds[0];
    console.log("Embeds on this message:", reaction.message.embeds.length);
    if (!embed) {
      console.log("Ignoring: no embed found on this message.");
      return;
    }
    console.log("Embed footer:", embed.footer);
    if (!embed.footer || !embed.footer.text) {
      console.log("Ignoring: embed has no footer text.");
      return;
    }

    const match = embed.footer.text.match(/Review ID: ([a-f0-9-]+)/i);
    console.log("Footer text was:", embed.footer.text, "| Regex match:", match);
    if (!match) {
      console.log("Ignoring: footer text didn't match the expected 'Review ID: ...' pattern.");
      return;
    }

    const reviewId = match[1];
    console.log("Parsed review id:", reviewId);

    const { data: matches, error: findError } = await supabase
      .from('reviews')
      .select('id, approved, name')
      .eq('id', reviewId)
      .limit(1);

    console.log("Supabase lookup result:", matches, findError);

    if (findError) {
      console.error("Error looking up review:", findError.message);
      return;
    }
    if (!matches || matches.length === 0) {
      console.log("Ignoring: no review found in database with that id.");
      return;
    }

    const review = matches[0];

    if (emojiName === '✅') {
      if (review.approved) {
        console.log("Already approved, nothing to do.");
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
        await reaction.message.reply(`🗑️ Deleted by ${user.username}. This review has been permanently removed.`);
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
