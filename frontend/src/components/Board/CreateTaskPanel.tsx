interface CreateTaskPanelProps {
  newTaskTitle: string;
  newTaskDescription: string;
  newTaskImage?: string;
  onChangeTitle: (value: string) => void;
  onChangeDescription: (value: string) => void;
  onChangeScreenshot: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onCreate: () => void;
}

export function CreateTaskPanel({
  newTaskTitle,
  newTaskDescription,
  newTaskImage,
  onChangeTitle,
  onChangeDescription,
  onChangeScreenshot,
  onCreate,
}: CreateTaskPanelProps): React.JSX.Element {
  return (
    <div className="task-create-panel">
      <h2>Create Task</h2>
      <label>
        Title
        <input
          value={newTaskTitle}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
            onChangeTitle(event.target.value)
          }
          placeholder="Add a task title"
        />
      </label>
      <label>
        Description
        <textarea
          value={newTaskDescription}
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
            onChangeDescription(event.target.value)
          }
          placeholder="Add task details"
        />
      </label>
      <label>
        Screenshot
        <input
          type="file"
          accept="image/png,image/jpeg"
          onChange={onChangeScreenshot}
        />
      </label>
      {newTaskImage ? (
        <img
          className="task-image-preview"
          src={newTaskImage}
          alt="New task screenshot preview"
        />
      ) : null}
      <button type="button" onClick={onCreate}>
        Create
      </button>
    </div>
  );
}
