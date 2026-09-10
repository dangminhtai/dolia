import Command from '../models/Command.js';

export async function commandChanges(cmd) {
    const cmdJSON = cmd.data.toJSON();
    const dbCmd = await Command.findOne({ name: cmd.data.name });

    if (!dbCmd) {
        await Command.create({
            name: cmd.data.name,
            description: cmd.data.description,
            dataJSON: cmdJSON
        });
        return true;
    }

    const changed = JSON.stringify(dbCmd.dataJSON) !== JSON.stringify(cmdJSON);
    if (changed) {
        dbCmd.description = cmd.data.description;
        dbCmd.dataJSON = cmdJSON;
        await dbCmd.save();
        return true;
    }
    return false;
}
