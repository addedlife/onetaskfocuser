const { publicAiConfig } = require("./_ai-core.cjs");

module.exports = async (req, res) => {
  res.status(200).set({
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-cache",
  }).json(publicAiConfig());
};
