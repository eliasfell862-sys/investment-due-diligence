import { createBrowserRouter } from 'react-router-dom';
import { NewProjectPage } from '../features/projects/NewProjectPage';
import { ProjectListPage } from '../features/projects/ProjectListPage';
import { appDb } from '../infrastructure/db/app-db';
import { ProjectRepository } from '../infrastructure/db/project-repository';
import { AppShell } from './AppShell';

const projectRepository = new ProjectRepository(appDb);

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <ProjectListPage /> },
      {
        path: 'projects/new',
        element: (
          <NewProjectPage
            onCreate={async (project) => {
              await projectRepository.save(project);
            }}
          />
        ),
      },
    ],
  },
]);
