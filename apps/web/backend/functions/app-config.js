const { publicAiConfig } = require("./_ai-core.cjs");

exports.handler = async function() {
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify(publicAiConfig()),
  };
};
