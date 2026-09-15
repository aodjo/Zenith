import js from "@eslint/js";
import tseslint from "typescript-eslint";
import jsdoc from "eslint-plugin-jsdoc";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "dump.js"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    plugins: { jsdoc },
    rules: {
      "jsdoc/require-jsdoc": [
        "error",
        {
          publicOnly: false,
          require: {
            FunctionDeclaration: true,
            FunctionExpression: true,
            ArrowFunctionExpression: true,
            MethodDefinition: true,
          },
        },
      ],
      "jsdoc/require-description": ["error", { descriptionStyle: "body" }],
      "jsdoc/require-param": "error",
      "jsdoc/require-param-name": "error",
      "jsdoc/require-param-type": "error",
      "jsdoc/require-param-description": "error",
      "jsdoc/check-param-names": "error",
      "jsdoc/require-returns": "error",
      "jsdoc/require-returns-type": "error",
      "jsdoc/require-returns-description": "error",
      "jsdoc/require-example": "error",
      "jsdoc/no-types": "off",
      "jsdoc/check-tag-names": ["error", { typed: false }],
    },
  },
  {
    files: ["test/**/*.ts", "eslint.config.js"],
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
);
