import { definePlugin, Field } from "millennium";

const SettingsContent = () => {
    return <Field label="Dota 2 Stats is active" />;
};

export default definePlugin(() => {
    console.log("Dota 2 Stats frontend loaded.");

    return {
        title: "Dota 2 Stats",
        content: <SettingsContent />,
    };
});
